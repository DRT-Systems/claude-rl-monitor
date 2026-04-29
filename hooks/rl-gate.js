#!/usr/bin/env node
// PreToolUse(Task) hook — hard-blocks subagent spawning when 5h or 7d
// utilization exceeds the threshold. Exit code 2 with a stderr message
// instructs Claude Code to refuse the tool call.
//
// Reads ~/.claude/.rl_cache.json (written by the VS Code extension every ~5 min).
// Fail-open when cache is missing/stale (cannot decide → allow rather than block).
//
// Threshold defaults: 85% for 5h, 85% for 7d, 85% for Sonnet (when subagent
// would use a Sonnet model). Override via env vars:
//   CLAUDE_RL_THRESHOLD_5H=NN
//   CLAUDE_RL_THRESHOLD_7D=NN
//   CLAUDE_RL_THRESHOLD_SONNET=NN
//   CLAUDE_RL_GATE_DISABLED=1   (skip the gate entirely)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CACHE_FILE = path.join(os.homedir(), '.claude', '.rl_cache.json');
const CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min

const T_5H     = parseInt(process.env.CLAUDE_RL_THRESHOLD_5H     || '85', 10);
const T_7D     = parseInt(process.env.CLAUDE_RL_THRESHOLD_7D     || '85', 10);
const T_SONNET = parseInt(process.env.CLAUDE_RL_THRESHOLD_SONNET || '85', 10);

function passthrough(rawIn) {
  // PreToolUse hooks must echo stdin to stdout to allow the tool call.
  process.stdout.write(rawIn);
  process.exit(0);
}

function block(reason, rawIn) {
  // Exit code 2 + stderr → Claude Code blocks the Task call and surfaces the reason.
  process.stdout.write(rawIn);
  process.stderr.write(`[rl-gate] BLOCKED: ${reason}\n`);
  process.exit(2);
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  if (process.env.CLAUDE_RL_GATE_DISABLED === '1') return passthrough(raw);

  // Parse the tool call. Only gate Task tool calls (subagent spawns).
  let toolInput;
  try { toolInput = JSON.parse(raw); } catch { return passthrough(raw); }
  if (toolInput?.tool_name !== 'Task') return passthrough(raw);

  const subagentModel = String(toolInput?.tool_input?.subagent_type || '').toLowerCase();
  const isSonnet = subagentModel.includes('sonnet');

  // Read cache. Fail-open on missing/stale.
  let cache;
  try {
    const obj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - obj.ts > CACHE_MAX_AGE_MS) return passthrough(raw);
    cache = obj.data;
  } catch {
    return passthrough(raw);
  }

  const p5  = Math.round(cache?.five_hour?.utilization        || 0);
  const p7  = Math.round(cache?.seven_day?.utilization        || 0);
  const ps  = Math.round(cache?.seven_day_sonnet?.utilization || 0);

  // Compute reset countdown for the message.
  const fmtReset = (resetVal) => {
    if (!resetVal) return '?';
    const ms = typeof resetVal === 'number' ? resetVal * 1000 : new Date(resetVal).getTime();
    const remaining = Math.max(0, ms - Date.now());
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  };

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
      `7-day Sonnet at ${ps}% (threshold ${T_SONNET}%) and subagent_type=${subagentModel} uses Sonnet. ` +
      `Either pick a non-Sonnet subagent_type or defer.`,
      raw
    );
  }

  return passthrough(raw);
});
