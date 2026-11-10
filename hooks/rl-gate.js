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
// File claims: a dispatch whose prompt has one or more `FILES: <abs path>, ...`
// lines claims those files on the shared board (rl-claims.js) under this
// session's name. Another session holding one → blocked with the `ask` command.
// rl-release.js (SubagentStop) releases the claim when the subagent ends.
// No FILES line → budget check only.
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
const { spawnSync } = require('child_process');

const CLAIMS_JS  = path.join(__dirname, 'rl-claims.js');
const NAMES_FILE = path.join(os.homedir(), '.claude', 'rl-session-names.json');
// Links a claim to its subagent transcript; rl-release.js computes the same key.
const promptKey = p => String(p || '').replace(/\s+/g, ' ').trim().slice(0, 300);

const CACHE_FILE = path.join(os.homedir(), '.claude', '.rl_cache.json');
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

const T_5H     = parseInt(process.env.CLAUDE_RL_THRESHOLD_5H     || '85', 10);
const T_7D     = parseInt(process.env.CLAUDE_RL_THRESHOLD_7D     || '85', 10);
const T_SONNET = parseInt(process.env.CLAUDE_RL_THRESHOLD_SONNET || '85', 10);
const T_FABLE  = parseInt(process.env.CLAUDE_RL_THRESHOLD_FABLE  || '85', 10);
// Agent definitions live in Claude Code's config root, which CLAUDE_CONFIG_DIR
// overrides. The usage cache stays in ~/.claude: the extension always writes it there.
const AGENTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'agents');

const SUBAGENT_WORK_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit']);
const DISPATCH_TOOLS      = new Set(['Task', 'Agent']);
const EDIT_ROLES          = new Set(['worker', 'architect']);

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
  // all rl-*.js helpers (checkpoint, schedule-resume, claims, memory-bank): DEFER needs them at the threshold
  return /rl-[a-z-]+\.js/.test(cmd);
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
  // Only plain agent names map to a file; anything else (paths, plugin:agent) skips the read.
  if (!/^[A-Za-z0-9_-]+$/.test(type)) return type.toLowerCase();
  try {
    const def = fs.readFileSync(path.join(AGENTS_DIR, `${type}.md`), 'utf8');
    const m = def.match(/^model:\s*(\S+)/m);
    if (m) return m[1].toLowerCase();
  } catch {}
  return type.toLowerCase();
}

function sessionTag(input) {
  try {
    const n = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'))[input.session_id]?.name;
    if (n) return n;
  } catch {}
  return String(input?.session_id || 'unknown').slice(0, 8);
}

// Claim the prompt's FILES on the shared board; block on another session's claim.
function claimFiles(input, raw) {
  const ti = input?.tool_input || {};
  const files = [...String(ti.prompt || '').matchAll(/^FILES:[ \t]*(.+)$/gm)]
    .flatMap(m => m[1].split(','))
    .map(s => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter(Boolean);
  if (!files.length) {
    // ponytail: warn-only; editing roles without FILES skip the claim board. Read-only dispatches may ignore it.
    if (!EDIT_ROLES.has(String(ti.subagent_type || ''))) return passthrough(raw);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      additionalContext: `[rl-gate] ${ti.subagent_type} dispatched without a FILES: line, so no files were claimed. ` +
        `If it edits files, put "FILES: <abs path>, ..." in the prompt next time. Read-only task: ignore.` } }));
    process.exit(0);
  }
  const tag = sessionTag(input);
  const r = spawnSync(process.execPath, [CLAIMS_JS, 'claim'], {
    input: JSON.stringify({ session: tag, agent: String(ti.subagent_type || 'agent'),
                            task: String(ti.description || ''), key: promptKey(ti.prompt), files }),
    encoding: 'utf8', cwd: input.cwd || process.cwd(), timeout: 4000,
  });
  if (r.status !== 3) return passthrough(raw); // claimed, or store trouble: fail open
  let conflicts = [];
  try { conflicts = JSON.parse(r.stdout).conflicts || []; } catch {}
  const own = conflicts.filter(c => c.holder_session === tag);
  if (own.length) {
    return block(
      `File held by another subagent of THIS session (${tag}), most likely still running: ` +
      own.map(c => `${c.file} (claim ${c.claim_id})`).join('; ') +
      `. Wait for it to finish (SubagentStop releases the claim), then retry. ` +
      `Only if that subagent is already done: node ~/.claude/hooks/rl-claims.js release <claim id>`
        .replace(/[\x00-\x1f\x7f]+/g, ' '),
      raw
    );
  }
  const list = conflicts.map(c => `${c.file} (held by session ${c.holder_session}, agent ${c.holder_agent})`).join('; ');
  return block(
    `File claim conflict: ${list}. Do not dispatch onto these files. Ask the holder: ` +
    `echo '{"from":"${tag}","file":"<path>","text":"<what you change and why>"}' | node ~/.claude/hooks/rl-claims.js ask  ` +
    `— dispatch other work meanwhile, check  node ~/.claude/hooks/rl-claims.js inbox ${tag}  and retry this dispatch once approved.`
      .replace(/[\x00-\x1f\x7f]+/g, ' '),
    raw
  );
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
  if (!cache) return isDispatch ? claimFiles(input, raw) : passthrough(raw);

  const p5 = Math.round(cache?.five_hour?.utilization        || 0);
  const p7 = Math.round(cache?.seven_day?.utilization        || 0);
  const sn = scoped(cache, 'sonnet', cache?.seven_day_sonnet);
  const fb = scoped(cache, 'fable',  null);
  const ps = sn.pct, pf = fb.pct;

  if (isDispatch) {
    // no control characters (newlines, ESC sequences): the value lands in the stderr block reason
    const subagentModel = dispatchModel(input?.tool_input).replace(/[\x00-\x1f\x7f]+/g, ' ');
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
        `Resets in ${fmtReset(fb.reset)}. Pass model: "opus" on the Agent/Task call, pick another role, or defer.`,
        raw
      );
    }
    return claimFiles(input, raw);
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
