#!/usr/bin/env node
// SessionStart hook — gives every session a short first name ("Ilke", "Raf", …)
// so you can tell sessions apart in the Agent Map and address them by name.
//
// - Sets the name through hookSpecificOutput.sessionTitle (same effect as /rename,
//   so the name is also the session's SendMessage address).
// - Never overwrites a title that already exists (resumed or /rename'd session).
// - Picks a name no other live session holds (live = ~/.claude/sessions/<pid>.json).
// - Tells the session its own name via additionalContext, also after /compact.
//
// Self-check:  node rl-session-name.js --test

'use strict';
const fs   = require('fs');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
const LIVE_DIR   = path.join(CLAUDE_DIR, 'sessions');

const NAMES = [
  'Ilke', 'Raf', 'Joost', 'Lien', 'Bram', 'Fien', 'Jens', 'Lotte', 'Stijn', 'Elke',
  'Pieter', 'Nele', 'Koen', 'Sofie', 'Dries', 'Femke', 'Geert', 'Hanne', 'Jef', 'Katrien',
  'Lars', 'Marieke', 'Ruben', 'Saar', 'Tine', 'Wout', 'Yana', 'Arne', 'Britt', 'Seppe',
];

function liveNames(selfId) {
  const used = new Set();
  let files = [];
  try { files = fs.readdirSync(LIVE_DIR); } catch {}
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(LIVE_DIR, f), 'utf8'));
      if (s.sessionId !== selfId && s.name) used.add(String(s.name).toLowerCase());
    } catch {}
  }
  return used;
}

// ponytail: two sessions starting in the same instant can pick the same name; add a lock file if that ever bites
function pickName(used) {
  const free = NAMES.filter(n => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) for (const n of NAMES) if (!used.has(`${n}${i}`.toLowerCase())) return `${n}${i}`;
}

function decide(input, used) {
  const existing = (input.session_title || '').trim();
  const titled = ['startup', 'resume', 'fork'].includes(input.source || 'startup');
  if (!existing && !titled) return null; // /clear or /compact without a known name: nothing to say
  const name = existing || pickName(used);
  const out = {
    hookEventName: 'SessionStart',
    additionalContext: `Your session name is "${name}". The user and other Claude sessions address you by this name (it is your SendMessage address). Answer to it.`,
  };
  if (!existing) out.sessionTitle = name;
  return { hookSpecificOutput: out };
}

if (process.argv[2] === '--test') {
  const assert = require('assert');
  const fresh = decide({ source: 'startup' }, new Set(NAMES.slice(1).map(n => n.toLowerCase())));
  assert.strictEqual(fresh.hookSpecificOutput.sessionTitle, NAMES[0]);       // only free name chosen
  assert.strictEqual(pickName(new Set(NAMES.map(n => n.toLowerCase()))), `${NAMES[0]}2`); // all taken → suffix
  const kept = decide({ source: 'resume', session_title: 'xwiki-sync' }, new Set());
  assert.strictEqual(kept.hookSpecificOutput.sessionTitle, undefined);      // never overwrite
  assert.match(kept.hookSpecificOutput.additionalContext, /xwiki-sync/);
  assert.strictEqual(decide({ source: 'compact' }, new Set()), null);
  console.log('ok');
  process.exit(0);
}

let raw = '';
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const out = decide(input, liveNames(input.session_id));
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
