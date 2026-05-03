#!/usr/bin/env node
// Schedule-resume helper — wires checkpoint + memory-bank + scheduler payload
// into one validated, side-effect-bounded operation. The orchestrator calls
// this before invoking Claude Code's `ScheduleWakeup` (in-session re-pace) or
// `CronCreate` (cross-session schedule) tool, so that:
//   - the cited checkpoint actually exists,
//   - the project memory-bank records the suspension and the planned resume,
//   - the emitted payload is bounded and shaped for the chosen tool.
//
// This script never calls a Claude tool itself. It validates inputs, performs
// disk side effects, and emits the right JSON shape on stdout. If the
// scheduled fire never happens (Claude exits before a `ScheduleWakeup`, or the
// `CronCreate` job is non-durable and the session ended), the checkpoint and
// the memory-bank entry remain on disk and the SessionStart hook
// (`rl-session-start.js`) surfaces them on the next session start. That is the
// fallback path that makes the whole flow recoverable.
//
// Two scheduler modes — both supported. The caller (or the orchestrator)
// surfaces both options to the user and lets the user choose:
//
//   mode = "wakeup"  → ScheduleWakeup payload
//                      { delaySeconds, prompt, reason }
//                      Bounds: delay_seconds ∈ [60, 3600] (Claude Code clamp).
//                      Survives session exit? No — session-bound.
//                      Best for: short, in-session re-pace (≤ 1h), user staying
//                      active. Cheaper, no disk write, exact delay.
//
//   mode = "cron"    → CronCreate payload
//                      { cron, prompt, recurring: false, durable: <bool> }
//                      Bounds: delay_seconds ∈ [60, 604800] (≤ 7 days).
//                      Survives session exit? Only when durable=true.
//                      Cron is one-shot (recurring:false), pinned to the fire
//                      time, with the minute nudged off :00/:30 to spread fleet
//                      load.
//                      Best for: long delays (> 1h), autonomous workflows where
//                      Claude session may exit before the fire time.
//
// Recommendation algorithm (when input.mode is omitted):
//   - delay > 3600s        → recommend "cron" with durable:true (long-window,
//                            session likely to die before fire).
//   - delay ≤ 3600s        → recommend "wakeup" (in-session re-pace, cheap).
//   - input.durable === true → force-recommend "cron" regardless of delay.
//
// When `mode` is omitted, helper emits BOTH payloads + a `recommendation`
// object so the orchestrator can show the user a side-by-side choice. When
// `mode` is explicit, only that payload is emitted.
//
// Usage:
//   echo '{
//     "mode":           "wakeup",        # OPTIONAL — omit for both + recommendation
//     "checkpoint_id":  "abc123",
//     "resume_prompt":  "...prompt the scheduler should fire...",
//     "delay_seconds":  1800,
//     "reason":         "5h reset, dispatch wave 2",   # wakeup only
//     "summary":        "wave 2: 4 architects",
//     "durable":        true             # cron only — persist across sessions
//   }' | node rl-schedule-resume.js prepare
//
// stdout (success):
//   {
//     "mode":           "wakeup" | "cron" | "both",
//     "recommendation": { "mode": "...", "why": "..." },   # always present
//     "wakeup":         { ... } ,                          # present when feasible
//     "cron":           { ... } ,                          # present when feasible
//     "checkpoint":     { ... },
//     "memory":         { "appended": true, "file": "..." },
//     "fire_at":        { "wakeup": "...", "cron": "..." } # populated per emitted shape
//   }
//
// Exit codes:
//   0 — success
//   1 — validation error (bad input, missing checkpoint, bad delay, ...)

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOME       = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const SESS_DIR   = path.join(CLAUDE_DIR, 'rl-sessions');

// Per-mode delay bounds — match the upstream tool's runtime clamp / sensible cap.
const BOUNDS = {
  wakeup: { min: 60, max: 3600   }, // ScheduleWakeup runtime clamp
  cron:   { min: 60, max: 604800 }, // 7 days — CronCreate auto-expires recurring
                                    // jobs at 7d; cap one-shots to the same horizon.
};

function fail(msg) {
  process.stderr.write(`rl-schedule-resume: ${msg}\n`);
  process.exit(1);
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function loadCheckpoint(id) {
  if (!id || !/^[a-f0-9]+$/i.test(id)) fail(`bad checkpoint id: ${id}`);
  const file = path.join(SESS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) fail(`no checkpoint ${id} at ${file}`);
  const r = readJsonSafe(file);
  if (!r) fail(`checkpoint ${id} unreadable or invalid JSON`);
  return r;
}

function ensureMemoryBank() {
  // Memory bank lives in the project root (not the Claude config root) so it
  // travels with the repo. Lazy-init only `progress.md` here; the full 6-file
  // hierarchy is bootstrapped by `rl-memory-bank.js init` when the orchestrator
  // wants the rest.
  const dir = path.join(process.cwd(), 'memory-bank');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'progress.md');
  if (!fs.existsSync(file)) {
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(file, `# Progress\n\n*Created: ${today}*\n\n## Recent checkpoints\n`);
  }
  return { dir, file };
}

function appendProgress(checkpoint, summary, modeLabel, delaySeconds, reason, fireAtNote) {
  const { file } = ensureMemoryBank();
  const ts    = new Date().toISOString();
  const block = [
    '',
    '---',
    `*${ts}*`,
    '',
    `Suspended — checkpoint \`${checkpoint.id}\` (branch \`${checkpoint.git?.branch || 'unknown'}\`).`,
    `Resume scheduled via **${modeLabel}** (in ${delaySeconds}s). ${fireAtNote}`,
    `Reason: ${reason}`,
    `Summary: ${summary}`,
    '',
    'Fallback: if the scheduled fire does not happen (e.g. Claude exits before a',
    '`ScheduleWakeup`, or a non-durable `CronCreate` job dies with the session),',
    'the SessionStart hook (`rl-session-start.js`) surfaces this checkpoint on',
    'the next session start. Run `/rl-resume` or invoke the `budget-orchestrator`',
    'agent to pick it up.',
    '',
  ].join('\n');
  fs.appendFileSync(file, block);
  return { appended: true, file };
}

// Pick the recommended mode based on delay + persistence intent.
function recommend(delaySeconds, durableHint) {
  if (durableHint === true) {
    return {
      mode: 'cron',
      why:  'durable=true was passed — only CronCreate persists across sessions (with durable:true).',
    };
  }
  if (delaySeconds > BOUNDS.wakeup.max) {
    return {
      mode: 'cron',
      why:  `delay_seconds=${delaySeconds} exceeds ScheduleWakeup's runtime clamp of ${BOUNDS.wakeup.max}s; use CronCreate (one-shot, durable:true recommended for cross-session safety).`,
    };
  }
  return {
    mode: 'wakeup',
    why:  `delay_seconds=${delaySeconds} fits in ScheduleWakeup's [${BOUNDS.wakeup.min}, ${BOUNDS.wakeup.max}]s window — cheaper, in-session re-pace, no disk write. Choose CronCreate instead if you expect Claude to exit before the fire time.`,
  };
}

// Convert a fire-time `Date` into a 5-field cron expression (one-shot:
// minute hour day-of-month month *). Nudge minute off :00 and :30 to avoid
// the fleet-spike marks. Within ±3 minutes of the requested fire time.
function buildOneShotCron(fireAt) {
  let m = fireAt.getMinutes();
  let h = fireAt.getHours();
  if (m === 0)  { m = 2; }       // 12:00 → 12:02
  else if (m === 30) { m = 28; } // 12:30 → 12:28
  // After nudging, the date/hour are unchanged — we only nudge the minute.
  const dom = fireAt.getDate();
  const mon = fireAt.getMonth() + 1; // cron months are 1-indexed
  return {
    expr:    `${m} ${h} ${dom} ${mon} *`,
    nudgedFireAt: new Date(fireAt.getFullYear(), fireAt.getMonth(), dom, h, m, 0, 0),
  };
}

function cmdPrepare() {
  let raw = '';
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) { fail(`invalid stdin JSON: ${e.message}`); }
    if (!input || typeof input !== 'object') fail('stdin must be a JSON object');

    const {
      mode,                       // optional — when omitted, emit both shapes + recommendation
      checkpoint_id,
      resume_prompt,
      delay_seconds,
      reason,
      summary,
      durable = false,
    } = input;

    if (mode !== undefined && mode !== 'wakeup' && mode !== 'cron') {
      fail(`mode must be "wakeup", "cron", or omitted (got ${JSON.stringify(mode)})`);
    }
    if (!checkpoint_id) fail('checkpoint_id required');
    if (typeof resume_prompt !== 'string' || !resume_prompt.trim()) {
      fail('resume_prompt required (non-empty string)');
    }
    if (!Number.isInteger(delay_seconds)) fail('delay_seconds must be an integer');
    if (typeof durable !== 'boolean') fail('durable must be a boolean');

    const reasonStr  = (reason  || '').toString().trim() || 'rate-limit resume';
    const summaryStr = (summary || '').toString().trim() || resume_prompt.slice(0, 120);

    const ckpt = loadCheckpoint(checkpoint_id);
    if (ckpt.project_dir && ckpt.project_dir !== process.cwd()) {
      fail(`checkpoint ${ckpt.id} belongs to a different project (${ckpt.project_dir})`);
    }

    // Determine which shapes to emit.
    const emitWakeup = (mode === undefined || mode === 'wakeup')
                       && delay_seconds >= BOUNDS.wakeup.min
                       && delay_seconds <= BOUNDS.wakeup.max;
    const emitCron   = (mode === undefined || mode === 'cron')
                       && delay_seconds >= BOUNDS.cron.min
                       && delay_seconds <= BOUNDS.cron.max;

    if (mode === 'wakeup' && !emitWakeup) {
      fail(`delay_seconds for mode=wakeup must be in [${BOUNDS.wakeup.min}, ${BOUNDS.wakeup.max}] (got ${delay_seconds})`);
    }
    if (mode === 'cron' && !emitCron) {
      fail(`delay_seconds for mode=cron must be in [${BOUNDS.cron.min}, ${BOUNDS.cron.max}] (got ${delay_seconds})`);
    }
    if (!emitWakeup && !emitCron) {
      fail(`delay_seconds=${delay_seconds} is outside both modes' bounds`);
    }

    const requestedFireAt = new Date(Date.now() + delay_seconds * 1000);
    const out = {
      checkpoint: {
        id:             ckpt.id,
        created_at:     ckpt.created_at,
        project_dir:    ckpt.project_dir,
        branch:         ckpt.git?.branch || '',
        blocked_reason: ckpt.payload?.blocked_reason || '',
        resume_after:   ckpt.payload?.resume_after   || '',
      },
      fire_at: {},
    };

    if (emitWakeup) {
      out.wakeup = {
        delaySeconds: delay_seconds,
        prompt:       resume_prompt,
        reason:       reasonStr,
      };
      out.fire_at.wakeup = requestedFireAt.toISOString();
    }
    if (emitCron) {
      const { expr, nudgedFireAt } = buildOneShotCron(requestedFireAt);
      out.cron = {
        cron:      expr,
        prompt:    resume_prompt,
        recurring: false,
        durable,
      };
      out.fire_at.cron = nudgedFireAt.toISOString();
    }

    // Resolve effective mode + recommendation.
    let resolvedMode;
    if (mode === 'wakeup' || mode === 'cron') resolvedMode = mode;
    else                                      resolvedMode = (emitWakeup && emitCron) ? 'both' : (emitWakeup ? 'wakeup' : 'cron');
    out.mode           = resolvedMode;
    out.recommendation = recommend(delay_seconds, durable);

    // Memory note records what was emitted; if both, the user will pick at the
    // call site, but the disk fallback is the same either way.
    const fireAtNote = resolvedMode === 'both'
      ? `Wakeup fire ≈ ${out.fire_at.wakeup}; cron fire (after off-minute nudge) ≈ ${out.fire_at.cron}.`
      : `Fire ≈ ${out.fire_at[resolvedMode]}.`;
    out.memory = appendProgress(ckpt, summaryStr, resolvedMode, delay_seconds, reasonStr, fireAtNote);

    process.stdout.write(JSON.stringify(out, null, 2));
  });
}

const cmd = process.argv[2];
if (cmd === 'prepare') cmdPrepare();
else {
  process.stderr.write('Usage: rl-schedule-resume.js prepare   (reads stdin JSON)\n');
  process.exit(1);
}
