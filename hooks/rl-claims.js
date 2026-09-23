#!/usr/bin/env node
// File-claim registry — shared by every Claude session on this machine.
// The budget-orchestrator records which session dispatched which agent on
// which files. Two claims may overlap on a file only after the holder's
// session approved a request in the message log.
//
// Usage:
//   echo '{"session","agent","task","files":[...]}' | node rl-claims.js claim
//       → exit 0 {claimed,id} | exit 3 {conflicts:[{file,holder_session,claim_id}]}
//   node rl-claims.js release <claimId> | --session <s>
//   node rl-claims.js list [--json]
//   echo '{"from","file","text"}' | node rl-claims.js ask     # ask holder(s) to share a file
//   node rl-claims.js inbox <session>                         # open asks to me + replies to me
//   node rl-claims.js reply <msgId> approve|deny [text]
//
// Store: ~/.claude/rl-claims/claims.json  { claims: [...], messages: [...] }

'use strict';
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const DIR   = path.join(os.homedir(), '.claude', 'rl-claims');
const STORE = path.join(DIR, 'claims.json');
const LOCK  = STORE + '.lock';
// ponytail: claims expire after 24h so dead sessions don't hold files forever; add heartbeats if agents run longer
const STALE_MS = 24 * 3600 * 1000;

const norm = f => {
  const p = path.resolve(f).replace(/\\/g, '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
const newId = () => crypto.randomBytes(4).toString('hex');
const fresh = c => Date.now() - Date.parse(c.claimed_at) < STALE_MS;

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    const recent = x => Date.now() - Date.parse(x.released_at || x.at) < STALE_MS;
    return { claims: (s.claims || []).filter(fresh), released: (s.released || []).filter(recent),
             messages: (s.messages || []).filter(recent) };
  } catch { return { claims: [], released: [], messages: [] }; }
}

// ponytail: lockfile + busy-wait, fine for a handful of sessions; swap for proper-lockfile if contention shows
function withStore(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  const until = Date.now() + 5000;
  for (;;) {
    try { fs.closeSync(fs.openSync(LOCK, 'wx')); break; } catch {
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.unlinkSync(LOCK); } catch {}
      if (Date.now() > until) { process.stderr.write('rl-claims: store locked\n'); process.exit(1); }
    }
  }
  try {
    const s = load();
    const out = fn(s);
    fs.writeFileSync(STORE + '.tmp', JSON.stringify(s, null, 2));
    fs.renameSync(STORE + '.tmp', STORE);
    return out;
  } finally { try { fs.unlinkSync(LOCK); } catch {} }
}

function stdinJson() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) {
    process.stderr.write(`Invalid JSON on stdin: ${e.message}\n`); process.exit(1);
  }
}

const print = o => process.stdout.write(JSON.stringify(o, null, 2) + '\n');

function approved(s, file, holder, requester) {
  return s.messages.some(m => m.file === file && m.to === holder && m.from === requester && m.verdict === 'approve');
}

function claim() {
  const p = stdinJson();
  if (!p.session || !p.agent || !Array.isArray(p.files) || !p.files.length) {
    process.stderr.write('claim needs session, agent, files[]\n'); process.exit(1);
  }
  const files = [...new Set(p.files.map(norm))];
  const res = withStore(s => {
    const conflicts = [];
    for (const f of files) for (const c of s.claims) {
      if (c.files.includes(f) && !approved(s, f, c.session, p.session)) {
        conflicts.push({ file: f, holder_session: c.session, holder_agent: c.agent, claim_id: c.id });
      }
    }
    if (conflicts.length) return { conflicts };
    const c = { id: newId(), session: p.session, agent: p.agent, task: p.task || '',
                project: process.cwd(), files, claimed_at: new Date().toISOString() };
    s.claims.push(c);
    return { claimed: true, id: c.id, files };
  });
  print(res);
  if (res.conflicts) process.exit(3);
}

function release(arg, session) {
  print(withStore(s => {
    const hit = c => arg === '--session' ? c.session === session : c.id === arg;
    const done = s.claims.filter(hit).map(c => ({ ...c, released_at: new Date().toISOString() }));
    s.claims = s.claims.filter(c => !hit(c));
    s.released.push(...done); // kept 24h so the agent map can show finished agents
    return { released: done.length };
  }));
}

function ask() {
  const p = stdinJson();
  if (!p.from || !p.file) { process.stderr.write('ask needs from, file\n'); process.exit(1); }
  const file = norm(p.file);
  print(withStore(s => {
    const holders = [...new Set(s.claims.filter(c => c.files.includes(file) && c.session !== p.from).map(c => c.session))];
    const ids = holders.map(to => {
      const m = { id: newId(), from: p.from, to, file, text: p.text || '', at: new Date().toISOString(), verdict: null };
      s.messages.push(m);
      return m.id;
    });
    return holders.length ? { asked: holders, message_ids: ids } : { asked: [], note: 'file not claimed by another session — just claim it' };
  }));
}

function reply(id, verdict, text) {
  if (!['approve', 'deny'].includes(verdict)) { process.stderr.write('verdict must be approve|deny\n'); process.exit(1); }
  print(withStore(s => {
    const m = s.messages.find(x => x.id === id);
    if (!m) return { error: 'no such message' };
    Object.assign(m, { verdict, reply: text || '', replied_at: new Date().toISOString() });
    return { replied: id, verdict };
  }));
}

function inbox(session) {
  const { messages } = load();
  print({
    to_answer: messages.filter(m => m.to === session && !m.verdict),
    answers:   messages.filter(m => m.from === session && m.verdict),
  });
}

function list(json) {
  const s = load();
  if (json) return print(s);
  if (!s.claims.length) return process.stdout.write('No active claims.\n');
  for (const c of s.claims) {
    process.stdout.write(`[${c.id}] session=${c.session} agent=${c.agent} since ${c.claimed_at}\n`);
    if (c.task) process.stdout.write(`    task: ${c.task}\n`);
    for (const f of c.files) process.stdout.write(`    - ${f}\n`);
  }
  const open = s.messages.filter(m => !m.verdict);
  if (open.length) {
    process.stdout.write(`\nOpen share requests:\n`);
    for (const m of open) process.stdout.write(`  [${m.id}] ${m.from} → ${m.to}: ${m.file} — ${m.text}\n`);
  }
}

const [cmd, a, b, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'claim':   claim(); break;
  case 'release': release(a, b); break;
  case 'ask':     ask(); break;
  case 'reply':   reply(a, b, rest.join(' ')); break;
  case 'inbox':   inbox(a); break;
  case 'list':    list(a === '--json'); break;
  default:
    process.stderr.write('usage: rl-claims.js claim|release|list|ask|inbox|reply\n'); process.exit(1);
}
