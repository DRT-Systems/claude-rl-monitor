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
// sessionTitle only sets the title (custom-title); Claude Code keeps its derived name in
// sessions/<pid>.json, so we track handed-out names here (also read by the Agent Map).
const REG_FILE   = path.join(CLAUDE_DIR, 'rl-session-names.json');
const WEEK_MS    = 7 * 24 * 3600 * 1000;

const NAMES = [
  'Ilke', 'Raf', 'Joost', 'Lien', 'Bram', 'Fien', 'Jens', 'Lotte', 'Stijn', 'Elke',
  'Pieter', 'Nele', 'Koen', 'Sofie', 'Dries', 'Femke', 'Geert', 'Hanne', 'Jef', 'Katrien',
  'Lars', 'Marieke', 'Ruben', 'Saar', 'Tine', 'Wout', 'Yana', 'Arne', 'Britt', 'Seppe',
];

const readReg = () => { try { return JSON.parse(fs.readFileSync(REG_FILE, 'utf8')) || {}; } catch { return {}; } };

// names held by other live sessions: their derived name + the first name we gave them.
// Entries under a minute old count too (sibling session starting right now, no pid file yet).
function liveNames(selfId, reg, now = Date.now()) {
  const used = new Set(), live = new Set();
  let files = [];
  try { files = fs.readdirSync(LIVE_DIR); } catch {}
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(LIVE_DIR, f), 'utf8'));
      if (s.sessionId === selfId) continue;
      live.add(s.sessionId);
      if (s.name) used.add(String(s.name).toLowerCase());
    } catch {}
  }
  for (const [id, e] of Object.entries(reg)) {
    if (id !== selfId && (live.has(id) || now - e.at < 60 * 1000)) used.add(e.name.toLowerCase());
  }
  return used;
}

// ponytail: read-modify-write without a lock; two hooks in the same millisecond can still clash
function remember(reg, id, name, now = Date.now()) {
  for (const k of Object.keys(reg)) if (now - reg[k].at > WEEK_MS) delete reg[k];
  reg[id] = { name, at: now };
  try { fs.writeFileSync(REG_FILE + '.tmp', JSON.stringify(reg)); fs.renameSync(REG_FILE + '.tmp', REG_FILE); } catch {}
}

// ponytail: two sessions starting in the same instant can pick the same name; add a lock file if that ever bites
function pickName(used) {
  const free = NAMES.filter(n => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) for (const n of NAMES) if (!used.has(`${n}${i}`.toLowerCase())) return `${n}${i}`;
}

function decide(input, used, reg = {}) {
  // our own record wins on resume, in case Claude Code does not pass session_title back
  const existing = (input.session_title || (reg[input.session_id] && reg[input.session_id].name) || '').trim();
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
  const known = decide({ source: 'compact', session_id: 'a' }, new Set(), { a: { name: 'Raf', at: 0 } });
  assert.match(known.hookSpecificOutput.additionalContext, /"Raf"/);       // registry remembers across /compact
  // a sibling's first name blocks reuse while fresh, even before its pid file exists
  const reg = { b: { name: 'Yana', at: Date.now() }, c: { name: 'Bram', at: 0 } };
  const used = liveNames('a', reg);
  assert.ok(used.has('yana') && !used.has('bram'));
  console.log('ok');
  process.exit(0);
}

let raw = '';
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const reg = readReg();
  const out = decide(input, liveNames(input.session_id, reg), reg);
  if (out) {
    const name = out.hookSpecificOutput.additionalContext.match(/"([^"]+)"/)[1];
    if (input.session_id) remember(reg, input.session_id, name);
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
});
