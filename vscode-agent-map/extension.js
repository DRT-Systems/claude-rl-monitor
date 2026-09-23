// Claude Agent Map — VS Code panel showing every Claude Code session active in the
// last 24h, the subagents it spawned (nested via parentAgentId), their running
// time and context tokens, plus file claims and share requests from rl-claims.js.
//
// Data sources (read-only):
//   ~/.claude/projects/<proj>/<sessionId>.jsonl                 session transcript
//   ~/.claude/projects/<proj>/<sessionId>/subagents/*.meta.json  agent type/description/parent
//   ~/.claude/projects/<proj>/<sessionId>/subagents/*.jsonl      agent transcript
//   ~/.claude/rl-claims/claims.json                              claims + share requests
//
// Self-check outside VS Code:  node extension.js   (prints collect() summary)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CLAUDE   = path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE, 'projects');
const CLAIMS   = path.join(CLAUDE, 'rl-claims', 'claims.json');
const CONTROL  = path.join(CLAUDE, 'agent-map', 'control.json'); // read by hooks/agent-control.js
const DAY_MS   = 24 * 3600 * 1000;
const SESSIONS = path.join(CLAUDE, 'sessions');
const SETTLE_MS = 15 * 1000; // a text-only last reply must sit this long before we call the agent finished
// ponytail: no transcript write for 10 min → treat as stopped (orphaned children get no completion notice); raise if you run >10 min single tool calls
const STALE_MS = 10 * 60 * 1000;

// <task-notification> blocks (background agent finished) → Map(agentId → status)
function notifications(file, st) {
  return cached(file + '#notif', st, () => {
    const out = new Map();
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch { return out; }
    const re = /<task-id>([^<]+)<\/task-id>[\s\S]{0,600}?<status>([^<]+)<\/status>/g;
    for (let m; (m = re.exec(txt));) out.set(m[1], m[2]);
    return out;
  });
}

const cache = new Map(); // file → { key, value }
function cached(file, st, fn) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value;
  const value = fn();
  cache.set(file, { key, value });
  return value;
}

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const stat     = f => { try { return fs.statSync(f); } catch { return null; } };
const ls       = d => { try { return fs.readdirSync(d); } catch { return []; } };

// ponytail: reads only the last 512 KB of a transcript; title/usage lines repeat often enough to be in there
function tailObjects(file, size) {
  const n = Math.min(size, 512 * 1024);
  if (!n) return [];
  const buf = Buffer.alloc(n);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (n < size) lines.shift(); // partial first line
  const out = [];
  for (const l of lines) { if (l) try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

function firstTimestamp(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8', 0, n).match(/"timestamp":"([^"]+)"/);
    return m ? Date.parse(m[1]) : null;
  } catch { return null; }
}

function summarize(file, st) {
  return cached(file, st, () => {
    const objs = tailObjects(file, st.size);
    let title = null, model = null, tokens = null, last = null, lastText = null;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (!title && o.type === 'ai-title') title = o.aiTitle;
      if (!last && (o.type === 'user' || o.type === 'assistant')) last = o;
      if (!lastText && o.type === 'assistant' && Array.isArray(o.message && o.message.content)) {
        const t = o.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        if (t) lastText = t.slice(0, 600);
      }
      const u = o.message && o.message.usage;
      if (tokens === null && u) {
        tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
        model = o.message.model || null;
      }
      if (title && tokens !== null && lastText) break;
    }
    // finished = last turn is an assistant reply with no tool call pending
    const content = last && last.message && last.message.content;
    const finished = !!last && last.type === 'assistant' &&
      !(Array.isArray(content) && content.some(c => c.type === 'tool_use'));
    return { title, model, tokens, finished, lastText, start: firstTimestamp(file) };
  });
}

function loadClaims() {
  const s = readJson(CLAIMS) || {};
  const fresh = x => Date.now() - Date.parse(x.released_at || x.claimed_at || x.at) < DAY_MS;
  return {
    claims:   [...(s.claims || []), ...(s.released || [])].filter(fresh),
    messages: (s.messages || []).filter(fresh),
  };
}

// Live Claude processes: ~/.claude/sessions/<pid>.json → { sessionId, status }
function liveSessions() {
  const live = new Map();
  for (const f of ls(SESSIONS)) {
    if (!f.endsWith('.json')) continue;
    const s = readJson(path.join(SESSIONS, f));
    if (!s || !s.sessionId || !s.pid) continue;
    try { process.kill(s.pid, 0); } catch (e) { if (e.code !== 'EPERM') continue; } // EPERM = exists, not ours
    live.set(s.sessionId, { status: s.status || 'open', name: s.name || null });
  }
  return live;
}

function collect() {
  const now = Date.now();
  const live = liveSessions();
  const { claims, messages } = loadClaims();
  const sessions = [];
  const control = readJson(CONTROL) || {};

  for (const proj of ls(PROJECTS)) {
    const pdir = path.join(PROJECTS, proj);
    for (const f of ls(pdir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(pdir, f);
      const st = stat(file);
      const id = f.slice(0, -6);
      if (!st || (now - st.mtimeMs > DAY_MS && !live.has(id))) continue; // open sessions always show
      const sum = summarize(file, st);
      const proc = live.get(id) || null;

      const agents = [];
      const sub = path.join(pdir, id, 'subagents');
      const notes = new Map(notifications(file, st));
      for (const m of ls(sub)) {
        if (!m.endsWith('.jsonl')) continue;
        const nst = stat(path.join(sub, m));
        if (nst && nst.size) for (const [k, v] of notifications(path.join(sub, m), nst)) notes.set(k, v);
      }
      for (const m of ls(sub)) {
        if (!m.endsWith('.meta.json')) continue;
        const metaFile = path.join(sub, m);
        const meta = readJson(metaFile) || {};
        const aid = m.slice('agent-'.length, -'.meta.json'.length);
        const jf = path.join(sub, `agent-${aid}.jsonl`);
        const jst = stat(jf);
        const mst = stat(metaFile);
        const a = jst && jst.size ? summarize(jf, jst) : {};
        const lastWrite = jst ? jst.mtimeMs : (mst ? mst.mtimeMs : now);
        const note = notes.get(aid) || null;
        const state = !proc ? 'session closed'
          : note ? note
          : a.finished && now - lastWrite > SETTLE_MS ? 'completed'
          : now - lastWrite > STALE_MS ? 'stopped (no activity)'
          : 'running';
        const ctl = control[aid] ? control[aid].action : null;
        const running = state === 'running';
        const start = a.start || (mst && (mst.birthtimeMs || mst.mtimeMs)) || now;
        const end = running ? now : lastWrite;
        agents.push({
          id: aid, parent: meta.parentAgentId || null, type: meta.agentType || '?',
          desc: meta.description || meta.agentType || aid, model: a.model || meta.model || null,
          tokens: a.tokens ?? null, start, ms: end - start, running, notified: !!note, ctl, lastText: a.lastText || null,
          state: running && ctl ? { pause: 'paused (holds at next tool call)', stop: 'stop requested', status: 'status requested' }[ctl] : state,
          claim: claims.find(c => c.task && c.task === meta.description) || null,
        });
      }

      // a parent waiting on its children writes nothing, so it inherits their liveness
      for (const a of agents.filter(x => x.running)) {
        for (let p = agents.find(x => x.id === a.parent); p && !p.running && !p.notified; p = agents.find(x => x.id === p.parent)) {
          p.running = true; p.state = 'waiting on agents'; p.ms = now - p.start;
        }
      }

      sessions.push({
        id, project: proj, title: sum.title || proj, model: sum.model, tokens: sum.tokens,
        mtime: st.mtimeMs, running: !!proc, status: proc ? proc.status : 'closed', name: proc ? proc.name : null, agents,
      });
    }
  }
  sessions.sort((a, b) => b.mtime - a.mtime);
  const linked = new Set(sessions.flatMap(s => s.agents.map(a => a.claim && a.claim.id)).filter(Boolean));
  return { now, sessions, messages, unlinked: claims.filter(c => !linked.has(c.id)) };
}

// action null = resume (drop the entry). Write tmp + rename so the hook never reads half a file.
function setControl(agent, action) {
  const all = readJson(CONTROL) || {};
  if (action) all[agent] = { action, at: new Date().toISOString() }; else delete all[agent];
  fs.writeFileSync(CONTROL + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(CONTROL + '.tmp', CONTROL);
}

function activate(context) {
  const vscode = require('vscode');
  let panel = null;
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  bar.command = 'agentMap.open';
  bar.tooltip = 'Claude Agent Map';
  context.subscriptions.push(bar);

  const tick = () => {
    let data;
    try { data = collect(); } catch { bar.text = '$(hubot) agents: error'; bar.show(); return; }
    const running = data.sessions.reduce((n, s) => n + s.agents.filter(a => a.running).length, 0);
    const asks = data.messages.filter(m => !m.verdict).length;
    bar.text = `$(hubot) ${running} agent${running === 1 ? '' : 's'}` + (asks ? ` $(comment-discussion) ${asks}` : '');
    bar.show();
    if (panel && panel.visible) panel.webview.postMessage(data);
  };
  // ponytail: polls every 4s; switch to fs.watch if the projects folder gets huge
  const timer = setInterval(tick, 4000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  tick();

  context.subscriptions.push(vscode.commands.registerCommand('agentMap.open', () => {
    if (panel) { panel.reveal(); return; }
    panel = vscode.window.createWebviewPanel('agentMap', 'Agent Map', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = new vscode.ThemeIcon('hubot');
    panel.webview.html = fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8');
    panel.webview.onDidReceiveMessage(m => {
      if (m === 'ready') return tick();
      if (m.cmd === 'open') return vscode.commands.executeCommand('claude-vscode.editor.open', m.session);
      if (m.cmd === 'control') { setControl(m.agent, m.action); tick(); }
    });
    panel.onDidDispose(() => { panel = null; });
  }));
}

module.exports = { activate, deactivate() {}, collect };

if (require.main === module) {
  const d = collect();
  for (const s of d.sessions) console.log(`${s.running ? '●' : '○'} ${s.title} [${s.project}] ${s.tokens ?? '-'} tok, ${s.agents.length} agents`);
  console.log(`claims unlinked: ${d.unlinked.length}, messages: ${d.messages.length}`);
}
