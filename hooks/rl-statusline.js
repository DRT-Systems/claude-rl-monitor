#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const HOME = require('os').homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const RL_WARN_FILE = path.join(CLAUDE_DIR, '.rl_warn');
const CAVEMAN_FLAG = path.join(CLAUDE_DIR, '.caveman-active');

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const c = (code) => `${ESC}[${code}m`;

// Inline caveman indicator — avoids PowerShell subprocess on every tick
function getCavemanIndicator() {
  try {
    const st = fs.statSync(CAVEMAN_FLAG);
    if (st.size > 64) return '';
    const raw = fs.readFileSync(CAVEMAN_FLAG, 'utf8').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const valid = ['off','lite','full','ultra','wenyan-lite','wenyan','wenyan-full','wenyan-ultra','commit','review','compress'];
    if (!valid.includes(raw)) return '';
    const label = (!raw || raw === 'full') ? 'CAVEMAN' : `CAVEMAN:${raw.toUpperCase()}`;
    return `${c('38;5;172')}[${label}]${RESET}`;
  } catch {
    return '';
  }
}

function formatRemaining(resetVal) {
  if (!resetVal) return '';
  const resetMs = typeof resetVal === 'number' ? resetVal * 1000 : new Date(resetVal).getTime();
  const remaining = Math.max(0, resetMs - Date.now());
  if (remaining <= 0) return '';
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

function pctColor(pct) {
  if (pct < 50) return c('32');  // green
  if (pct < 80) return c('33');  // yellow
  return c('31');                // red
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(raw); } catch {}

  const fiveHour = data?.rate_limits?.five_hour;
  const sevenDay  = data?.rate_limits?.seven_day;
  const sonnet    = data?.rate_limits?.seven_day_sonnet;

  const fivePct  = fiveHour?.used_percentage ?? null;
  const sevenPct = sevenDay?.used_percentage ?? null;
  const sonnetPct = sonnet?.used_percentage ?? null;
  const fiveReset = fiveHour?.resets_at ?? null;

  // Write/clear flag for UserPromptSubmit hook
  const atWarning = (fivePct !== null && fivePct >= 80) || (sevenPct !== null && sevenPct >= 80);
  if (atWarning) {
    try {
      fs.writeFileSync(RL_WARN_FILE, JSON.stringify({
        five_pct:  Math.round(fivePct  ?? 0),
        seven_pct: Math.round(sevenPct ?? 0),
        resets_at: fiveReset,
        ts: Date.now(),
      }));
    } catch {}
  } else {
    try { fs.unlinkSync(RL_WARN_FILE); } catch {}
  }

  const parts = [];

  // Caveman mode indicator
  const caveman = getCavemanIndicator();
  if (caveman) parts.push(caveman);

  // Rate limit display
  if (fivePct !== null) {
    const p5 = Math.round(fivePct);
    const p7 = sevenPct !== null ? Math.round(sevenPct) : null;
    const ps = sonnetPct !== null ? Math.round(sonnetPct) : null;
    const countdown = formatRemaining(fiveReset);

    let rl = `${c('90')}│${RESET} ${pctColor(p5)}5h:${p5}%${RESET}`;
    if (p7 !== null) rl += ` ${pctColor(p7)}7d:${p7}%${RESET}`;
    if (ps !== null) rl += ` ${pctColor(ps)}Sonnet:${ps}%${RESET}`;
    if (countdown)   rl += ` ${c('90')}↺${countdown}${RESET}`;
    parts.push(rl);
  }

  process.stdout.write(parts.join(' ') + '\n');
});
