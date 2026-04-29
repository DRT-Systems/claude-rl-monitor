#!/usr/bin/env node
// StopFailure hook — fires when Claude hits a rate limit.
// Side effects only (StopFailure cannot block):
//   1. Parses current session JSONL → extracts todos + modified files
//   2. Writes ~/.claude/rl-handoff.json for next SessionStart to pick up
//   3. Sends Windows balloon notification
//
// Adapted from: elb-pr/claudikins-automatic-context-manager (MIT)
//   https://github.com/elb-pr/claudikins-automatic-context-manager
//   - Session JSONL parsing for TodoWrite calls and Write/Edit tool_use blocks
//   - Handoff-state JSON schema (objective, active_todos, modified_files, git)
//   - Path encoding for ~/.claude/projects/<encoded-cwd>/<session>.jsonl

'use strict';
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME       = require('os').homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const HANDOFF_FILE = path.join(CLAUDE_DIR, 'rl-handoff.json');

// Find the most recently modified .jsonl for the current project directory
function findLatestJsonl() {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const cwd = process.cwd();

  // Claude encodes project paths by replacing non-alphanumeric with '-' and collapsing runs
  const encoded = cwd
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/\//g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  // Try a few candidate encodings
  const candidates = [];
  if (fs.existsSync(projectsDir)) {
    for (const dir of fs.readdirSync(projectsDir)) {
      if (dir.toLowerCase().includes(encoded.split('-').slice(-2).join('-'))) {
        candidates.push(path.join(projectsDir, dir));
      }
    }
  }

  let best = null;
  let bestMtime = 0;
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = path.join(dir, f);
        const mt = fs.statSync(fp).mtimeMs;
        if (mt > bestMtime) { bestMtime = mt; best = fp; }
      }
    } catch {}
  }
  return best;
}

function parseJsonl(jsonlPath) {
  if (!jsonlPath || !fs.existsSync(jsonlPath)) return null;

  const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  let firstUserMessage = '';
  let latestTodos = [];
  const modifiedFiles = new Set();

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Capture first user message as objective
    if (!firstUserMessage && entry.type === 'user') {
      const content = entry.message?.content;
      const text = Array.isArray(content)
        ? content.find(c => c.type === 'text')?.text
        : (typeof content === 'string' ? content : '');
      if (text) firstUserMessage = text.slice(0, 300);
    }

    // Track latest TodoWrite state and modified files
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
          latestTodos = block.input.todos
            .filter(t => t.status !== 'completed')
            .map(t => ({ status: t.status, content: t.content }));
        }
        if (['Write', 'Edit', 'MultiEdit'].includes(block.name) && block.input?.file_path) {
          modifiedFiles.add(block.input.file_path);
        }
      }
    }
  }

  return {
    objective: firstUserMessage,
    todos: latestTodos,
    modifiedFiles: [...modifiedFiles].slice(-10),
  };
}

function sendWindowsToast(title, body) {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Warning
$n.Visible = $true
$n.ShowBalloonTip(6000, '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Warning)
Start-Sleep -Milliseconds 6500
$n.Dispose()
`.trim();
  try {
    execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 9000 });
  } catch {}
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(raw); } catch {}

  // Collect git context
  let gitBranch = '';
  let gitStatus = '';
  try { gitBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { gitStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf8', timeout: 3000 }).trim().slice(0, 500); } catch {}

  // Parse session for handoff data
  const jsonlPath  = findLatestJsonl();
  const session    = parseJsonl(jsonlPath);

  const handoff = {
    version:    '1.0',
    created_at: new Date().toISOString(),
    project_dir: process.cwd(),
    reason:     'rate_limit',
    context: {
      objective:     session?.objective || '',
      active_todos:  session?.todos || [],
      modified_files: session?.modifiedFiles || [],
    },
    git: { branch: gitBranch, status: gitStatus },
  };

  try { fs.writeFileSync(HANDOFF_FILE, JSON.stringify(handoff, null, 2)); } catch {}

  sendWindowsToast(
    'Claude Code — Rate Limit Hit',
    'Session paused. Handoff state saved. Open a new chat to resume.'
  );

  process.exit(0);
});
