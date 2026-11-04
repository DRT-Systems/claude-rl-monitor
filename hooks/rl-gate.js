#!/usr/bin/env node
// PreToolUse hook — hard-blocks tool calls when 5h/7d utilization exceeds the
// threshold. Two modes:
//   1. Task/Agent dispatch (any context): block NEW subagent spawns at threshold.
//   2. Bash/Edit/Write/MultiEdit in SUBAGENT context: block subagent's next
//      tool call at threshold and instruct it to checkpoint + return.
//
// Subagent context detected via presence of `agent_id` in hook stdin (Claude
// Code adds it for tool calls originating from a Task/Agent child).
// Main-agent tool calls of Bash/Edit/Write/MultiEdit are passed through —
// only NEW Agent dispatches from main agent are blocked.
//
// Whitelist: Bash commands containing "rl-checkpoint" are always allowed,
// so a subagent can save its checkpoint after being blocked.
//
// Reads ~/.claude/.rl_cache.json (written by the VS Code extension every ~5 min).
// Fail-open when cache is missing/stale.
//
// Threshold defaults: 85% for 5h, 7d, Sonnet and Fable. Overrides:
//   CLAUDE_RL_THRESHOLD_5H=NN
//   CLAUDE_RL_THRESHOLD_7D=NN
//   CLAUDE_RL_THRESHOLD_SONNET=NN
//   CLAUDE_RL_THRESHOLD_FABLE=NN
//   CLAUDE_RL_GATE_DISABLED=1   (skip entirely)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CACHE_FILE = path.join(os.homedir(), '.claude', '.rl_cache.json');
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

const T_5H     = parseInt(process.env.CLAUDE_RL_THRESHOLD_5H     || '85', 10);
const T_7D     = parseInt(process.env.CLAUDE_RL_THRESHOLD_7D     || '85', 10);
const T_SONNET = parseInt(process.env.CLAUDE_RL_THRESHOLD_SONNET || '85', 10);
const T_FABLE  = parseInt(process.env.CLAUDE_RL_THRESHOLD_FABLE  || '85', 10);
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');

const SUBAGENT_WORK_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit']);
const DISPATCH_TOOLS      = new Set(['Task', 'Agent']);

function passthrough(rawIn) {
  process.stdout.write(rawIn);
  process.exit(0);
}

function block(reason, rawIn) {
  process.stdout.write(rawIn);
  process.stderr.write(`[rl-gate] BLOCKED: ${reason}\n`);
  process.exit(2);
}

function isSubagentContext(input) {
  return Boolean(input?.agent_id);
}

function isCheckpointCommand(input) {
  if (input?.tool_name !== 'Bash') return false;
  const cmd = String(input?.tool_input?.command || '');
  return cmd.includes('rl-checkpoint');
}

function readCache() {
  try {
    const obj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - obj.ts > CACHE_MAX_AGE_MS) return null;
    return obj.data;
  } catch {
    return null;
  }
}

function fmtReset(resetVal) {
  if (!resetVal) return '?';
  const ms = typeof resetVal === 'number' ? resetVal * 1000 : new Date(resetVal).getTime();
  const remaining = Math.max(0, ms - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

// Per-model weekly caps arrive in limits[] (kind 'weekly_scoped'); the old
// seven_day_<model> buckets are null. Fall back to the legacy bucket if present.
function scoped(cache, model, legacy) {
  const l = (cache?.limits || []).find(x =>
    x.kind === 'weekly_scoped' && x.scope?.model?.display_name?.toLowerCase() === model);
  return l ? { pct: Math.round(l.percent || 0), reset: l.resets_at }
           : { pct: Math.round(legacy?.utilization || 0), reset: legacy?.resets_at };
}

// Model the dispatch will run on: explicit `model` param, else the agent
// definition's frontmatter, else the subagent_type name itself.
function dispatchModel(toolInput) {
  if (toolInput?.model) return String(toolInput.model).toLowerCase();
  const type = String(toolInput?.subagent_type || '');
  try {
    const def = fs.readFileSync(path.join(AGENTS_DIR, `${type}.md`), 'utf8');
    const m = def.match(/^model:\s*(\S+)/m);
    if (m) return m[1].toLowerCase();
  } catch {}
  return type.toLowerCase();
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  if (process.env.CLAUDE_RL_GATE_DISABLED === '1') return passthrough(raw);

  let input;
  try { input = JSON.parse(raw); } catch { return passthrough(raw); }

  const toolName = input?.tool_name;
  const isDispatch     = DISPATCH_TOOLS.has(toolName);
  const isSubagentWork = SUBAGENT_WORK_TOOLS.has(toolName) && isSubagentContext(input);

  if (!isDispatch && !isSubagentWork) return passthrough(raw);

  if (isCheckpointCommand(input)) return passthrough(raw);

  const cache = readCache();
  if (!cache) return passthrough(raw);

  const p5 = Math.round(cache?.five_hour?.utilization        || 0);
  const p7 = Math.round(cache?.seven_day?.utilization        || 0);
  const sn = scoped(cache, 'sonnet', cache?.seven_day_sonnet);
  const fb = scoped(cache, 'fable',  null);
  const ps = sn.pct, pf = fb.pct;

  if (isDispatch) {
    const subagentModel = dispatchModel(input?.tool_input);
    const isSonnet = subagentModel.includes('sonnet');
    const isFable  = subagentModel.includes('fable');

    if (p5 >= T_5H) {
      return block(
        `5-hour session at ${p5}% (threshold ${T_5H}%). Resets in ${fmtReset(cache?.five_hour?.resets_at)}. ` +
        `Do not spawn subagents. Either work directly, defer, or wait for reset. ` +
        `Override: set CLAUDE_RL_GATE_DISABLED=1 in environment.`,
        raw
      );
    }
    if (p7 >= T_7D) {
      return block(
        `7-day weekly at ${p7}% (threshold ${T_7D}%). Resets in ${fmtReset(cache?.seven_day?.resets_at)}. ` +
        `Spawning subagents would burn weekly budget. Reconsider scope.`,
        raw
      );
    }
    if (isSonnet && ps >= T_SONNET) {
      return block(
        `7-day Sonnet at ${ps}% (threshold ${T_SONNET}%) and this dispatch runs on ${subagentModel}. ` +
        `Either pick a non-Sonnet subagent_type or defer.`,
        raw
      );
    }
    if (isFable && pf >= T_FABLE) {
      return block(
        `7-day Fable at ${pf}% (threshold ${T_FABLE}%) and this dispatch runs on ${subagentModel}. ` +
        `Resets in ${fmtReset(fb.reset)}. Pass MODEL: opus (or pick another role) or defer.`,
        raw
      );
    }
    return passthrough(raw);
  }

  // Subagent work tool path: block at threshold to force in-flight checkpoint.
  if (p5 >= T_5H || p7 >= T_7D) {
    const reason5 = p5 >= T_5H ? `5h at ${p5}%` : null;
    const reason7 = p7 >= T_7D ? `7d at ${p7}%` : null;
    const which = [reason5, reason7].filter(Boolean).join(' + ');
    return block(
      `Subagent budget gate: ${which}. CHECKPOINT NOW. ` +
      `Save your current state via:  echo '{...}' | node ~/.claude/hooks/rl-checkpoint.js save  ` +
      `then return literally: CHECKPOINTED <id> — orchestrator: resume after reset. ` +
      `Resets in ${fmtReset(cache?.five_hour?.resets_at)}.`,
      raw
    );
  }

  return passthrough(raw);
});
