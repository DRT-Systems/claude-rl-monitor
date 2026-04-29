#!/usr/bin/env node
// SessionStart hook — injects saved rate-limit handoff state into new session.
// Fires only on fresh startup (source === 'startup'), not on /clear or resume.
// Consumes the handoff file after reading (one-shot injection).
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
const MAX_AGE_MS   = 8 * 3600 * 1000; // ignore handoffs older than 8 hours

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

  if (!fs.existsSync(HANDOFF_FILE)) {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  let handoff = {};
  try { handoff = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8')); } catch {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  // Ignore stale handoffs
  const age = Date.now() - new Date(handoff.created_at).getTime();
  if (age > MAX_AGE_MS) {
    try { fs.unlinkSync(HANDOFF_FILE); } catch {}
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  // Ignore handoffs from a different project
  if (handoff.project_dir && handoff.project_dir !== process.cwd()) {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  // Consume the handoff (one-shot)
  try { fs.unlinkSync(HANDOFF_FILE); } catch {}

  const todos = handoff.context?.active_todos || [];
  const files = handoff.context?.modified_files || [];
  const obj   = handoff.context?.objective || '';

  const todoBlock = todos.length > 0
    ? todos.map(t => `  [${t.status}] ${t.content}`).join('\n')
    : '  (none captured)';

  const fileBlock = files.length > 0
    ? files.map(f => `  ${f}`).join('\n')
    : '  (none captured)';

  const context = [
    '🔄 RATE LIMIT HANDOFF — Previous session was interrupted by a usage limit.',
    '',
    `Project:     ${handoff.project_dir}`,
    `Branch:      ${handoff.git?.branch || 'unknown'}`,
    `Interrupted: ${handoff.created_at}`,
    '',
    'Last objective:',
    `  ${obj || '(not captured)'}`,
    '',
    'Active todos at interruption:',
    todoBlock,
    '',
    'Recently modified files:',
    fileBlock,
    '',
    'Resume where we left off. Acknowledge this handoff briefly, then continue.',
  ].join('\n');

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
