// PreToolUse hook: lets the Agent Map pause, resume, stop or ping a subagent.
// Agent Map writes ~/.claude/agent-map/control.json  { "<agentId>": { "action": "pause"|"stop"|"status", "at": iso } }
// Main-thread tool calls (no agent_id) are never touched.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONTROL = path.join(os.homedir(), '.claude', 'agent-map', 'control.json');
const MAX_HOLD_MS = 9 * 60 * 1000; // hook timeout in settings.json is 600s; stay under it

const read = () => { try { return JSON.parse(fs.readFileSync(CONTROL, 'utf8')); } catch { return {}; } };
const deny = reason => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  let id;
  try { id = JSON.parse(input).agent_id; } catch { process.exit(0); }
  if (!id) process.exit(0);

  let c = read()[id];
  if (c && c.action === 'status') {
    const all = read(); delete all[id];
    try { fs.writeFileSync(CONTROL, JSON.stringify(all, null, 2)); } catch {}
    deny('Agent Map status request from the user: before anything else, reply with ONE short line: what you are doing now, what is done, what is left. Then retry this same tool call.');
  }
  // ponytail: polls every 2s while paused; fs.watch if that ever matters
  const t0 = Date.now();
  while (c && c.action === 'pause' && Date.now() - t0 < MAX_HOLD_MS) { await sleep(2000); c = read()[id]; }
  if (c && c.action === 'pause') deny('Paused by the user via Agent Map. Retry this same tool call; it will wait until resumed.');
  if (c && c.action === 'stop') deny('Stopped by the user via Agent Map. Do NOT call any more tools. Reply with a brief summary of what you finished and what is left, then end.');
  process.exit(0);
});
