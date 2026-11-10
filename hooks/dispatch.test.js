#!/usr/bin/env node
// Self-check for rl-gate.js claims + rl-release.js. Runs against a temp home,
// never touches the real ~/.claude.   node hooks/dispatch.test.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { spawnSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-dispatch-'));
const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_RL_GATE_DISABLED: '' };
const run = (script, input) => spawnSync(process.execPath, [path.join(__dirname, script)],
  { input: JSON.stringify(input), env, encoding: 'utf8' });
const store = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'rl-claims', 'claims.json'), 'utf8'));

const file = path.join(home, 'src', 'a.js');
const prompt = `Fix the bug in a.js.\nFILES: ${file}\nOnly edit FILES.`;
const dispatch = sid => ({ session_id: sid, cwd: home, tool_name: 'Agent',
  tool_input: { subagent_type: 'worker', description: 'fix a', prompt } });

// 1. no FILES → pass, no claim
let r = run('rl-gate.js', { ...dispatch('s1'), tool_input: { subagent_type: 'explorer', prompt: 'look around' } });
assert.strictEqual(r.status, 0, r.stderr);

// 2. FILES → claimed under session s1, with prompt key
r = run('rl-gate.js', dispatch('s1'));
assert.strictEqual(r.status, 0, r.stderr);
assert.strictEqual(store().claims.length, 1);
assert.strictEqual(store().claims[0].session, 's1');

// 3. other session, same file → blocked with ask command
r = run('rl-gate.js', dispatch('s2'));
assert.strictEqual(r.status, 2);
assert.match(r.stderr, /File claim conflict/);
assert.match(r.stderr, /rl-claims\.js ask/);

// 3b. same session, unreleased earlier claim → blocked with release hint, not ask
r = run('rl-gate.js', dispatch('s1'));
assert.strictEqual(r.status, 2);
assert.match(r.stderr, /THIS session/);

// 4. subagent that checkpointed keeps the claim
const tdir = path.join(home, 'proj', 's1', 'subagents');
fs.mkdirSync(tdir, { recursive: true });
const tx = (id, last) => fs.writeFileSync(path.join(tdir, `agent-${id}.jsonl`),
  [{ type: 'user', message: { role: 'user', content: prompt } },
   { type: 'assistant', message: { content: [{ type: 'text', text: last }] } }].map(JSON.stringify).join('\n'));
const stop = id => run('rl-release.js', { session_id: 's1', agent_id: id,
  transcript_path: path.join(home, 'proj', 's1.jsonl') });
tx('x1', 'CHECKPOINTED abc123 — orchestrator: resume after reset.');
assert.strictEqual(stop('x1').status, 0);
assert.strictEqual(store().claims.length, 1);

// 5. normal finish → released
tx('x2', 'Done. Tests pass.');
assert.strictEqual(stop('x2').status, 0);
assert.strictEqual(store().claims.length, 0);

fs.rmSync(home, { recursive: true, force: true });
console.log('dispatch.test.js: ok');
