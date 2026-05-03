#!/usr/bin/env node
// SessionStart hook — surfaces saved rate-limit state into a fresh session.
// Two sources, both filtered to the current project (cwd):
//   1. ~/.claude/rl-handoff.json     — written by rl-stop-failure.js when
//                                      StopFailure(rate_limit) fires. One-shot:
//                                      consumed on read.
//   2. ~/.claude/rl-sessions/*.json  — checkpoints saved by subagents via
//                                      rl-checkpoint.js. Listed (not consumed)
//                                      so the orchestrator decides what to do.
//
// Fires only on fresh startup (source === 'startup'), not on /clear or resume.
//
// Adapted from: elb-pr/claudikins-automatic-context-manager (MIT)
//   https://github.com/elb-pr/claudikins-automatic-context-manager
//   - SessionStart matcher restricted to "startup"
//   - hookSpecificOutput.additionalContext injection format
//   - Handoff file consumption (one-shot delete after read)

'use strict';
const fs   = require('fs');
const path = require('path');

const HOME         = require('os').homedir();
const CLAUDE_DIR   = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const HANDOFF_FILE = path.join(CLAUDE_DIR, 'rl-handoff.json');
const SESS_DIR     = path.join(CLAUDE_DIR, 'rl-sessions');
const MAX_AGE_MS   = 8 * 3600 * 1000; // ignore handoffs older than 8 hours

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function loadHandoff() {
  if (!fs.existsSync(HANDOFF_FILE)) return null;
  const h = readJsonSafe(HANDOFF_FILE);
  if (!h) return null;
  const age = Date.now() - new Date(h.created_at).getTime();
  if (age > MAX_AGE_MS) {
    try { fs.unlinkSync(HANDOFF_FILE); } catch {}
    return null;
  }
  if (h.project_dir && h.project_dir !== process.cwd()) return null;
  // Consume (one-shot)
  try { fs.unlinkSync(HANDOFF_FILE); } catch {}
  return h;
}

function loadPendingCheckpoints() {
  if (!fs.existsSync(SESS_DIR)) return [];
  let entries;
  try { entries = fs.readdirSync(SESS_DIR); } catch { return []; }
  return entries
    .filter(f => f.endsWith('.json'))
    .map(f => readJsonSafe(path.join(SESS_DIR, f)))
    .filter(r => r && r.project_dir === process.cwd())
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function renderHandoff(h) {
  const todos = h.context?.active_todos || [];
  const files = h.context?.modified_files || [];
  const obj   = h.context?.objective || '';

  const todoBlock = todos.length > 0
    ? todos.map(t => `  [${t.status}] ${t.content}`).join('\n')
    : '  (none captured)';

  const fileBlock = files.length > 0
    ? files.map(f => `  ${f}`).join('\n')
    : '  (none captured)';

  return [
    '🔄 RATE LIMIT HANDOFF — Previous session was interrupted by a usage limit.',
    '',
    `Project:     ${h.project_dir}`,
    `Branch:      ${h.git?.branch || 'unknown'}`,
    `Interrupted: ${h.created_at}`,
    '',
    'Last objective:',
    `  ${obj || '(not captured)'}`,
    '',
    'Active todos at interruption:',
    todoBlock,
    '',
    'Recently modified files:',
    fileBlock,
  ].join('\n');
}

function renderCheckpoints(records) {
  const lines = records.map(r => {
    const p = r.payload || {};
    const desc   = (p.task_description || '').slice(0, 100);
    const reason = (p.blocked_reason   || '').slice(0, 100);
    const after  = p.resume_after || '(unspecified)';
    return [
      `  • ${r.id}  ${r.created_at}  branch=${r.git?.branch || 'unknown'}`,
      `      task:    ${desc || '(no description)'}`,
      `      blocked: ${reason || '(none)'}`,
      `      resume:  ${after}`,
    ].join('\n');
  }).join('\n');

  return [
    `📌 PENDING CHECKPOINTS (${records.length}) — work suspended by prior rate-limit blocks.`,
    '',
    lines,
    '',
    'Inspect a checkpoint:  node ~/.claude/hooks/rl-checkpoint.js show <id>',
    'Manual resume:         /rl-resume   (or /rl-resume <id>)',
    'Auto-resume:           invoke the budget-orchestrator agent — it will run INIT,',
    '                       pick the oldest checkpoint, dispatch a Task with the saved',
    '                       payload, then consume on success.',
  ].join('\n');
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let hookInput = {};
  try { hookInput = JSON.parse(raw); } catch {}

  // Only inject on fresh startup
  if (hookInput.source && hookInput.source !== 'startup') {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  const handoff = loadHandoff();
  const pending = loadPendingCheckpoints();

  if (!handoff && pending.length === 0) {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  const blocks = [];
  if (handoff)             blocks.push(renderHandoff(handoff));
  if (pending.length > 0)  blocks.push(renderCheckpoints(pending));
  blocks.push('Acknowledge the saved state briefly, then continue from where we left off.');

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: blocks.join('\n\n'),
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
