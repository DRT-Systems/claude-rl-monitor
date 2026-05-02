---
name: budget-check
description: Check Claude Pro / Max rate-limit budget before spawning subagents. Returns current 5h, 7d, and Sonnet utilization, headroom, max-safe subagent count, and pending checkpoint count. Use this BEFORE every Task tool call when running a long workflow.
---

# Budget Check

Query the current rate-limit budget and decide whether spawning more subagents is safe. Pairs with the `rl-gate` PreToolUse hook (which hard-blocks at 85%) — this skill lets the orchestrator plan ahead instead of trial-and-error.

## When to use

- Before any `Task` tool call in a long-running orchestration.
- At the start of a new session, to check if there are pending checkpoints from a previous rate-limit-blocked session that should be resumed.
- After any subagent finishes, to decide whether to spawn the next batch.

## Steps

### 1. Read the budget

Run:

```bash
node ~/.claude/hooks/rl-budget.js
```

Returns JSON like:

```json
{
  "available": true,
  "thresholds": { "five_hour": 85, "seven_day": 85, "sonnet": 85 },
  "current":    { "five_hour": 38, "seven_day": 33, "sonnet": 56 },
  "headroom":   { "five_hour": 47, "seven_day": 52, "sonnet": 29 },
  "max_subagents": 9,
  "resets_in":  { "five_hour": "1h30m", "seven_day": "5d12h", "sonnet": "5d12h" },
  "cache_age_minutes": 2,
  "stale": false,
  "reasoning": "OK to spawn up to 9 subagents..."
}
```

### 2. Check pending checkpoints

Run:

```bash
node ~/.claude/hooks/rl-checkpoint.js list
```

Returns a list of `{id, created_at, task_description, blocked_reason, resume_after}` records. Anything in this list is work that was suspended due to a previous rate-limit hit and should be resumed before starting new work.

### 3. Decide

Use the `available`, `max_subagents`, and pending checkpoint count to decide one of:

| Situation | Action |
|---|---|
| `available: true` AND no checkpoints | Spawn up to `max_subagents` new subagents |
| `available: true` AND checkpoints exist | Resume from oldest checkpoint first (`rl-checkpoint.js show <id>`), then spawn new |
| `available: false` (5h or 7d ≥ threshold) | Do NOT spawn. Either work directly without `Task`, or save current state via `rl-checkpoint.js save` and stop |
| `headroom.five_hour < 20` | Yellow zone — spawn but pass `CHECKPOINT_AFTER_EVERY_STEP=1` instruction in the subagent prompt so its work is recoverable if the gate fires |
| `stale: true` | Cache is older than 15 min. Decision is best-effort — open VS Code for ~10 sec to refresh the cache |

### 4. (Optional) Per-Sonnet headroom

If the subagent will use a Sonnet model and `headroom.sonnet < 10`, do NOT spawn that subagent — the gate will block specifically on Sonnet. Pick a non-Sonnet `subagent_type` (Opus or Haiku) instead.

## Output contract

Always return a one-line decision summary to the parent agent:

```
BUDGET: 5h=38% 7d=33% sn=56% — safe, max 9 subagents, 0 pending checkpoints
```

or

```
BUDGET: 5h=87% (BLOCKED) resets in 23m — 2 pending checkpoints, defer new work
```

## Reference

- `rl-gate.js` enforces the same thresholds at the tool layer — this skill is the planning side
- Cline 6-file memory bank: see `rl-memory-bank.js` and prior art note in repo README
