#!/usr/bin/env node
// Budget query utility — outputs a JSON summary used by the budget-check skill
// and the budget-orchestrator agent to plan subagent dispatch without tripping
// the rl-gate hook.
//
// Output shape:
//   {
//     "available": true|false,
//     "thresholds": { "five_hour": 85, "seven_day": 85, "sonnet": 85 },
//     "current":    { "five_hour": NN, "seven_day": NN, "sonnet": NN },
//     "headroom":   { "five_hour": NN, "seven_day": NN, "sonnet": NN },
//     "max_subagents": N,           // rough cap based on 5% per agent
//     "resets_in":  { "five_hour": "2h30m", "seven_day": "5d12h", "sonnet": "5d12h" },
//     "cache_age_minutes": N,
//     "stale": false,
//     "reasoning": "..."
//   }
//
// Override env vars:
//   CLAUDE_RL_THRESHOLD_5H, CLAUDE_RL_THRESHOLD_7D, CLAUDE_RL_THRESHOLD_SONNET
//   CLAUDE_RL_PER_AGENT_5H_PCT      (default 5)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CACHE_FILE = path.join(os.homedir(), '.claude', '.rl_cache.json');

const T_5H     = parseInt(process.env.CLAUDE_RL_THRESHOLD_5H     || '85', 10);
const T_7D     = parseInt(process.env.CLAUDE_RL_THRESHOLD_7D     || '85', 10);
const T_SONNET = parseInt(process.env.CLAUDE_RL_THRESHOLD_SONNET || '85', 10);
const PER_AGENT_PCT = parseInt(process.env.CLAUDE_RL_PER_AGENT_5H_PCT || '5', 10);

function fmtReset(resetVal) {
  if (!resetVal) return null;
  const ms = typeof resetVal === 'number' ? resetVal * 1000 : new Date(resetVal).getTime();
  const remaining = Math.max(0, ms - Date.now());
  if (remaining <= 0) return null;
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  const m = Math.floor((remaining % 3600000)  / 60000);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

let cacheObj;
try { cacheObj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {
  process.stdout.write(JSON.stringify({
    available: true,             // fail-open: no cache means no veto
    thresholds: { five_hour: T_5H, seven_day: T_7D, sonnet: T_SONNET },
    current: null,
    cache_age_minutes: null,
    stale: true,
    reasoning: 'No cache file present. Cannot determine usage. Allowing subagents (fail-open). Run the VS Code extension or open Claude Code once to populate the cache.',
  }, null, 2));
  process.exit(0);
}

const data = cacheObj.data || {};
const ageMin = Math.floor((Date.now() - cacheObj.ts) / 60000);
const stale = ageMin > 15;

const p5 = Math.round(data?.five_hour?.utilization        || 0);
const p7 = Math.round(data?.seven_day?.utilization        || 0);
const ps = Math.round(data?.seven_day_sonnet?.utilization || 0);

const headroom5  = Math.max(0, T_5H     - p5);
const headroom7  = Math.max(0, T_7D     - p7);
const headroomSn = Math.max(0, T_SONNET - ps);

const maxSubagents = Math.max(0, Math.floor(headroom5 / PER_AGENT_PCT));

let available = true;
const reasons = [];
if (p5 >= T_5H) { available = false; reasons.push(`5h at ${p5}% >= ${T_5H}%`); }
if (p7 >= T_7D) { available = false; reasons.push(`7d at ${p7}% >= ${T_7D}%`); }

const out = {
  available,
  thresholds: { five_hour: T_5H, seven_day: T_7D, sonnet: T_SONNET },
  current:    { five_hour: p5,   seven_day: p7,   sonnet: ps },
  headroom:   { five_hour: headroom5, seven_day: headroom7, sonnet: headroomSn },
  max_subagents: available ? maxSubagents : 0,
  resets_in: {
    five_hour: fmtReset(data?.five_hour?.resets_at),
    seven_day: fmtReset(data?.seven_day?.resets_at),
    sonnet:    fmtReset(data?.seven_day_sonnet?.resets_at),
  },
  cache_age_minutes: ageMin,
  stale,
  reasoning: available
    ? `OK to spawn up to ${maxSubagents} subagents (5h headroom ${headroom5}% / ${PER_AGENT_PCT}% per agent). For Sonnet subagents specifically, headroom is ${headroomSn}%.`
    : `Blocked: ${reasons.join(', ')}. ${available ? '' : 'Defer or wait for reset.'}`,
};

process.stdout.write(JSON.stringify(out, null, 2));
