#!/usr/bin/env node
// UserPromptSubmit hook — injects rate limit warning when 5h or 7d usage >= 80%.
// Auto-snoozes for 10 minutes after each warning to avoid spam.
//
// Adapted from: elb-pr/claudikins-automatic-context-manager (MIT)
//   https://github.com/elb-pr/claudikins-automatic-context-manager
//   - Flag file read pattern (~/.claude/.rl_warn) populated by statusLine hook
//   - Snooze + dismiss state files
//   - hookSpecificOutput.additionalContext injection for UserPromptSubmit

'use strict';
const fs = require('fs');
const path = require('path');

const HOME = require('os').homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const RL_WARN_FILE  = path.join(CLAUDE_DIR, '.rl_warn');
const RL_SNOOZE_FILE = path.join(CLAUDE_DIR, '.rl_snooze');

const SNOOZE_MS = 10 * 60 * 1000; // 10 minutes between warnings

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  // Pass through when no flag
  if (!fs.existsSync(RL_WARN_FILE)) {
    process.stdout.write(raw);
    process.exit(0);
    return;
  }

  // Respect snooze
  if (fs.existsSync(RL_SNOOZE_FILE)) {
    try {
      const until = parseInt(fs.readFileSync(RL_SNOOZE_FILE, 'utf8').trim(), 10);
      if (Date.now() < until) {
        process.stdout.write(raw);
        process.exit(0);
        return;
      }
    } catch {}
    try { fs.unlinkSync(RL_SNOOZE_FILE); } catch {}
  }

  let flagData = {};
  try { flagData = JSON.parse(fs.readFileSync(RL_WARN_FILE, 'utf8')); } catch {}

  const p5 = flagData.five_pct ?? 0;
  const p7 = flagData.seven_pct ?? 0;

  let resetsMsg = '';
  if (flagData.resets_at) {
    const resetMs = typeof flagData.resets_at === 'number'
      ? flagData.resets_at * 1000
      : new Date(flagData.resets_at).getTime();
    const remaining = Math.max(0, resetMs - Date.now());
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    resetsMsg = ` Resets in ${h}h${m}m.`;
  }

  // Set snooze so next message doesn't warn again immediately
  try { fs.writeFileSync(RL_SNOOZE_FILE, String(Date.now() + SNOOZE_MS)); } catch {}

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `⚠️ RATE LIMIT WARNING: Session (5h) at ${p5}%, weekly at ${p7}%.${resetsMsg} ` +
        `Consider running /compact to reduce context, or wrapping up current work before the limit resets.`,
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
