#!/usr/bin/env node
// SubagentStop hook: releases the file claim rl-gate.js made when this
// subagent was dispatched. The claim is matched by prompt key (first 300
// chars of the dispatch prompt, whitespace-collapsed). A subagent that
// returned "CHECKPOINTED <id>" keeps its claim so the resumed run still owns
// its files. Never blocks: always exits 0.

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

const STORE     = path.join(os.homedir(), '.claude', 'rl-claims', 'claims.json');
const CLAIMS_JS = path.join(__dirname, 'rl-claims.js');
// Same as rl-gate.js.
const promptKey = p => String(p || '').replace(/\s+/g, ' ').trim().slice(0, 300);
const text = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';

// First user message = dispatch prompt; last assistant text = final reply.
function readTranscript(file) {
  let prompt = null, last = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    const c = d.message && d.message.content;
    if (prompt === null && d.type === 'user') prompt = text(c);
    if (d.type === 'assistant' && text(c)) last = text(c);
  }
  return { prompt: prompt || '', last };
}

function transcriptPath(input) {
  if (input.agent_transcript_path) return input.agent_transcript_path;
  if (!input.transcript_path || !input.agent_id) return null;
  const dir = input.transcript_path.replace(/\.jsonl$/, '');
  return path.join(dir, 'subagents', `agent-${input.agent_id}.jsonl`);
}

function main(raw) {
  const input = JSON.parse(raw);
  const file = transcriptPath(input);
  if (!file || !fs.existsSync(file)) return;
  const t = readTranscript(file);
  const last = input.last_assistant_message || t.last;
  if (/^\s*CHECKPOINTED\b/m.test(last)) return;
  const key = promptKey(t.prompt);
  if (!key) return;
  let claims = [];
  try { claims = JSON.parse(fs.readFileSync(STORE, 'utf8')).claims || []; } catch { return; }
  for (const c of claims.filter(c => c.key === key)) {
    spawnSync(process.execPath, [CLAIMS_JS, 'release', c.id], { encoding: 'utf8', timeout: 4000 });
  }
}

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => { try { main(raw); } catch {} process.exit(0); });
