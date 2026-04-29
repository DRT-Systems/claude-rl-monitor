// Claude Code Rate Limit Monitor — VS Code status bar extension
// Polls api.anthropic.com/api/oauth/usage using the OAuth token from
// ~/.claude/.credentials.json and renders 5h + 7d usage in the status bar.

'use strict';
const vscode = require('vscode');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const https = require('https');

let statusBar      = null;
let pollTimer      = null;
let lastSuccessData = null;     // cached last good response
let lastSuccessTs   = 0;        // ms epoch of last good response
let backoffUntil    = 0;        // ms epoch — skip polls until this time

const DEFAULT_CREDS = path.join(os.homedir(), '.claude', '.credentials.json');
const DEFAULT_BACKOFF_MS = 10 * 60 * 1000; // 10 min default backoff on 429
const CACHE_FILE = path.join(os.homedir(), '.claude', '.rl_cache.json');
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — older cache discarded
const FIRST_POLL_DELAY_MS = 5_000; // brief stagger after activation to avoid burst polls

function getCredsPath() {
  const cfg = vscode.workspace.getConfiguration('claudeRlMonitor').get('credentialsPath');
  return (cfg && cfg.trim()) ? cfg.trim() : DEFAULT_CREDS;
}

function getPollIntervalMs() {
  const sec = vscode.workspace.getConfiguration('claudeRlMonitor').get('pollIntervalSeconds') || 300;
  return Math.max(120, Math.min(1800, sec)) * 1000;
}

function readToken() {
  try {
    const raw = fs.readFileSync(getCredsPath(), 'utf8');
    const json = JSON.parse(raw);
    return json?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || !obj.data || !obj.ts) return false;
    if (Date.now() - obj.ts > CACHE_MAX_AGE_MS) return false;
    lastSuccessData = obj.data;
    lastSuccessTs   = obj.ts;
    return true;
  } catch {
    return false;
  }
}

function saveCache() {
  if (!lastSuccessData || !lastSuccessTs) return;
  try {
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ data: lastSuccessData, ts: lastSuccessTs }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}

function formatRemaining(value) {
  if (!value) return '';
  const ms = typeof value === 'number' ? value * 1000 : new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const remaining = Math.max(0, ms - Date.now());
  if (remaining <= 0) return '';
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Accept': 'application/json',
        'User-Agent': 'claude-rl-monitor-vscode/1.2'
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve({ ok: true, data: JSON.parse(body) }); }
          catch (e) { reject(e); }
          return;
        }
        const retryAfter = parseInt(res.headers['retry-after'], 10);
        const err = new Error(`HTTP ${res.statusCode}`);
        err.status = res.statusCode;
        err.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
        err.body = body.slice(0, 200);
        reject(err);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function renderFromData(data) {
  const fh = data?.five_hour;
  const sd = data?.seven_day;
  const sn = data?.seven_day_sonnet;

  if (!fh) {
    statusBar.text = '$(warning) Claude RL: no data';
    statusBar.tooltip = 'OAuth usage endpoint returned no five_hour block.';
    statusBar.backgroundColor = undefined;
    return;
  }

  const p5 = Math.round(fh.utilization || 0);
  const p7 = sd ? Math.round(sd.utilization || 0) : null;
  const ps = sn ? Math.round(sn.utilization || 0) : null;
  const reset5 = formatRemaining(fh.resets_at);
  const reset7 = formatRemaining(sd?.resets_at);

  const maxPct = Math.max(p5, p7 ?? 0, ps ?? 0);
  let icon = '$(check)';
  let bg;
  if (maxPct >= 90) {
    icon = '$(error)';
    bg = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (maxPct >= 80) {
    icon = '$(warning)';
    bg = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (maxPct >= 50) {
    icon = '$(pulse)';
  }

  let text = `${icon} 5h:${p5}%`;
  if (p7 !== null) text += `  7d:${p7}%`;
  if (ps !== null) text += `  Sonnet:${ps}%`;
  if (reset5)      text += `  ↺${reset5}`;

  statusBar.text = text;
  statusBar.backgroundColor = bg;

  const ageMin = lastSuccessTs ? Math.floor((Date.now() - lastSuccessTs) / 60000) : 0;
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**Claude Code — Rate Limits**\n\n`);
  md.appendMarkdown(`| Window | Used | Resets in |\n| --- | ---: | ---: |\n`);
  md.appendMarkdown(`| 5-hour session | **${p5}%** | ${reset5 || '—'} |\n`);
  if (p7 !== null) md.appendMarkdown(`| 7-day weekly | **${p7}%** | ${reset7 || '—'} |\n`);
  if (ps !== null) md.appendMarkdown(`| 7-day Sonnet | **${ps}%** | ${formatRemaining(sn?.resets_at) || '—'} |\n`);
  md.appendMarkdown(`\nData age: ${ageMin === 0 ? 'fresh' : ageMin + ' min ago'}\n\nClick to refresh now.`);
  statusBar.tooltip = md;
}

async function poll() {
  if (Date.now() < backoffUntil) {
    if (lastSuccessData) renderFromData(lastSuccessData);
    return;
  }

  const token = readToken();
  if (!token) {
    statusBar.text = '$(error) Claude RL: no token';
    statusBar.tooltip = `Could not read OAuth token from ${getCredsPath()}`;
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    return;
  }

  try {
    const result = await fetchUsage(token);
    lastSuccessData = result.data;
    lastSuccessTs = Date.now();
    backoffUntil = 0;
    saveCache();
    renderFromData(result.data);
  } catch (err) {
    if (err.status === 429) {
      const wait = err.retryAfterMs && err.retryAfterMs > 0 ? err.retryAfterMs : DEFAULT_BACKOFF_MS;
      backoffUntil = Date.now() + wait;
    }

    if (lastSuccessData) {
      renderFromData(lastSuccessData);
      const waitSec = Math.ceil((backoffUntil - Date.now()) / 1000);
      const note = err.status === 429
        ? ` (rate-limited by usage endpoint, retry in ${waitSec}s)`
        : ` (last fetch failed: ${err.message})`;
      const md = new vscode.MarkdownString(`Showing cached data${note}`);
      statusBar.tooltip = md;
      return;
    }

    // No cached data — show a soft warning that does not paint the bar red unless persistent
    if (err.status === 429) {
      const waitMin = Math.ceil((backoffUntil - Date.now()) / 60000);
      statusBar.text = `$(clock) Claude RL: cooling down (${waitMin}m)`;
      statusBar.tooltip = `Usage endpoint returned HTTP 429. Will retry after ${waitMin} minutes. Click to force a refresh anyway.`;
      statusBar.backgroundColor = undefined;
    } else {
      statusBar.text = '$(warning) Claude RL: fetch failed';
      statusBar.tooltip = `Fetch failed: HTTP ${err.status || '?'} ${err.message}\n${err.body || ''}`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }
}

function startTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, getPollIntervalMs());
}

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'claudeRlMonitor.refresh';
  statusBar.show();

  // Render cached data immediately if available so we don't show "loading" or "rate-limited"
  // when a perfectly valid cache exists from the previous session.
  const cached = loadCache();
  if (cached) {
    renderFromData(lastSuccessData);
  } else {
    statusBar.text = '$(sync~spin) Claude RL';
    statusBar.tooltip = 'Loading rate limit data…';
  }

  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeRlMonitor.refresh', () => {
      backoffUntil = 0;
      poll();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeRlMonitor.pollIntervalSeconds')) startTimer();
    })
  );

  context.subscriptions.push({
    dispose: () => { if (pollTimer) clearInterval(pollTimer); }
  });

  // Stagger the first poll so simultaneous activations across windows don't burst the endpoint.
  setTimeout(poll, FIRST_POLL_DELAY_MS);
  startTimer();
}

function deactivate() {
  if (pollTimer) clearInterval(pollTimer);
}

module.exports = { activate, deactivate };
