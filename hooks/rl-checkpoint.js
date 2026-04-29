#!/usr/bin/env node
// Checkpoint utility — used by subagents (or the orchestrator on their behalf)
// to persist enough state to resume work later, after the rate limit resets.
//
// Usage:
//   echo '{...checkpoint payload...}' | node rl-checkpoint.js save
//   node rl-checkpoint.js list                  # list pending checkpoints
//   node rl-checkpoint.js show <id>             # print one checkpoint
//   node rl-checkpoint.js consume <id>          # delete a checkpoint
//
// Checkpoint payload schema:
//   {
//     "task_description": "what the subagent was doing",
//     "todos":           [{ status, content }, ...],
//     "files_modified":  ["path", ...],
//     "next_steps":      ["string", ...],
//     "blocked_reason":  "5h at 85%",
//     "context":         "free-form notes",
//     "resume_after":    "ISO-8601"   // when budget is expected to be free
//   }
//
// Checkpoints land in ~/.claude/rl-sessions/<id>.json with:
//   id, created_at, project_dir, git_branch, payload (caller-supplied)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SESS_DIR = path.join(os.homedir(), '.claude', 'rl-sessions');

function ensureDir() {
  try { fs.mkdirSync(SESS_DIR, { recursive: true }); } catch {}
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function gitInfo() {
  let branch = '';
  let status = '';
  try { branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { status = execFileSync('git', ['status', '--short'], { encoding: 'utf8', timeout: 3000 }).trim().slice(0, 800); } catch {}
  return { branch, status };
}

function cmdSave() {
  ensureDir();
  let raw = '';
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(raw); } catch (e) {
      process.stderr.write(`Invalid JSON payload: ${e.message}\n`);
      process.exit(1);
    }
    const id = crypto.randomBytes(6).toString('hex');
    const record = {
      id,
      created_at:  new Date().toISOString(),
      project_dir: process.cwd(),
      git:         gitInfo(),
      payload,
    };
    const file = path.join(SESS_DIR, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    process.stdout.write(JSON.stringify({ saved: true, id, file }, null, 2));
  });
}

function listFiles() {
  ensureDir();
  return fs.readdirSync(SESS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(SESS_DIR, f));
}

function cmdList() {
  const items = listFiles()
    .map(readJson)
    .filter(Boolean)
    .filter(r => !r.payload?.project_dir || r.project_dir === process.cwd())
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(r => ({
      id:               r.id,
      created_at:       r.created_at,
      task_description: r.payload?.task_description || '',
      blocked_reason:   r.payload?.blocked_reason   || '',
      resume_after:     r.payload?.resume_after     || '',
      project_dir:      r.project_dir,
      branch:           r.git?.branch || '',
    }));
  process.stdout.write(JSON.stringify({ count: items.length, items }, null, 2));
}

function cmdShow(id) {
  if (!id) { process.stderr.write('show needs <id>\n'); process.exit(1); }
  const file = path.join(SESS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) { process.stderr.write(`No such checkpoint: ${id}\n`); process.exit(1); }
  process.stdout.write(fs.readFileSync(file, 'utf8'));
}

function cmdConsume(id) {
  if (!id) { process.stderr.write('consume needs <id>\n'); process.exit(1); }
  const file = path.join(SESS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) { process.stderr.write(`No such checkpoint: ${id}\n`); process.exit(1); }
  fs.unlinkSync(file);
  process.stdout.write(JSON.stringify({ consumed: true, id }));
}

const cmd = process.argv[2];
if      (cmd === 'save')    cmdSave();
else if (cmd === 'list')    cmdList();
else if (cmd === 'show')    cmdShow(process.argv[3]);
else if (cmd === 'consume') cmdConsume(process.argv[3]);
else {
  process.stderr.write('Usage: rl-checkpoint.js {save|list|show <id>|consume <id>}\n');
  process.exit(1);
}
