#!/usr/bin/env node
// Memory bank utility — Cline-style 6-file hierarchy for project-level state.
// Adapted from: cline/cline (memory bank concept)
//   https://github.com/cline/cline
// Schema also seen in: hudrazine/claude-code-memory-bank, alioshr/memory-bank-mcp,
//   ipospelov/mcp-memory-bank, GreatScottyMac/context-portal.
//
// File hierarchy (DAG of dependencies — top reads-from-below, bottom is "hot"):
//
//   projectbrief.md       (foundational scope, rarely changes)
//      ↓
//   productContext.md     (why the project exists, user goals)
//   systemPatterns.md     (architecture, design patterns)
//   techContext.md        (stack, deps, constraints)
//      ↓
//   activeContext.md      (current focus, what we're doing right now)  ← hot
//      ↓
//   progress.md           (ledger: what is done, what is pending)       ← hot
//
// On resume, only activeContext.md and progress.md must be re-read; the others
// change rarely.
//
// Usage:
//   node rl-memory-bank.js init [path]     # creates the 6 files in ./memory-bank/
//   node rl-memory-bank.js read            # prints the hot files (active + progress)
//   node rl-memory-bank.js read --all      # prints all 6
//   echo "..." | node rl-memory-bank.js append <file>   # append to one of the 6

'use strict';
const fs   = require('fs');
const path = require('path');

const FILES = [
  'projectbrief.md',
  'productContext.md',
  'systemPatterns.md',
  'techContext.md',
  'activeContext.md',
  'progress.md',
];
const HOT = ['activeContext.md', 'progress.md'];

function bankDir(arg) {
  const root = arg && !arg.startsWith('-') ? path.resolve(arg) : process.cwd();
  return path.join(root, 'memory-bank');
}

function templates() {
  const date = new Date().toISOString().slice(0, 10);
  return {
    'projectbrief.md':  `# Project Brief\n\n*Created: ${date}*\n\n## Scope\n\n_Describe the foundational scope of this project. What it is, what it is not._\n\n## Goals\n\n_Top-level goals._\n\n## Non-goals\n\n_Things explicitly out of scope._\n`,
    'productContext.md':`# Product Context\n\n*Created: ${date}*\n\n## Why this exists\n\n_The user problem this project solves._\n\n## User goals\n\n_What users need to accomplish._\n\n## Constraints\n\n_Business / regulatory / domain constraints._\n`,
    'systemPatterns.md':`# System Patterns\n\n*Created: ${date}*\n\n## Architecture\n\n_High-level architecture diagram or description._\n\n## Key patterns\n\n_Recurring design patterns used in this codebase._\n\n## Component map\n\n_Major components and their responsibilities._\n`,
    'techContext.md':   `# Tech Context\n\n*Created: ${date}*\n\n## Stack\n\n_Languages, frameworks, runtimes._\n\n## Dependencies\n\n_External libraries and services._\n\n## Constraints\n\n_Tech-level constraints (browser support, perf budgets, etc.)._\n`,
    'activeContext.md': `# Active Context\n\n*Created: ${date}*\n\n## Current focus\n\n_What we are working on right now._\n\n## In-flight changes\n\n_Files currently being modified, branches in flight._\n\n## Open questions\n\n_Things that need a decision before we can proceed._\n`,
    'progress.md':      `# Progress\n\n*Created: ${date}*\n\n## Done\n\n- (nothing yet)\n\n## In progress\n\n- (nothing yet)\n\n## Pending\n\n- (nothing yet)\n\n## Recent checkpoints\n\n_Append: \`<ISO-ts> <id> <summary>\`_\n`,
  };
}

function cmdInit(arg) {
  const dir = bankDir(arg);
  fs.mkdirSync(dir, { recursive: true });
  const tpl = templates();
  const created = [];
  const skipped = [];
  for (const f of FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) { skipped.push(f); continue; }
    fs.writeFileSync(p, tpl[f]);
    created.push(f);
  }
  process.stdout.write(JSON.stringify({ dir, created, skipped }, null, 2));
}

function cmdRead(args) {
  const all = args.includes('--all');
  const dir = bankDir();
  if (!fs.existsSync(dir)) {
    process.stdout.write(JSON.stringify({ exists: false, dir }));
    return;
  }
  const want = all ? FILES : HOT;
  const out = { dir, files: {} };
  for (const f of want) {
    const p = path.join(dir, f);
    out.files[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  process.stdout.write(JSON.stringify(out, null, 2));
}

function cmdAppend(file) {
  if (!FILES.includes(file)) {
    process.stderr.write(`File must be one of: ${FILES.join(', ')}\n`);
    process.exit(1);
  }
  let raw = '';
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('end', () => {
    const dir = bankDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, file);
    const ts = new Date().toISOString();
    const block = `\n\n---\n*${ts}*\n\n${raw.trimEnd()}\n`;
    fs.appendFileSync(p, block);
    process.stdout.write(JSON.stringify({ appended: true, file: p, ts }));
  });
}

const cmd = process.argv[2];
if      (cmd === 'init')   cmdInit(process.argv[3]);
else if (cmd === 'read')   cmdRead(process.argv.slice(3));
else if (cmd === 'append') cmdAppend(process.argv[3]);
else {
  process.stderr.write('Usage: rl-memory-bank.js {init [path]|read [--all]|append <file>}\n');
  process.exit(1);
}
