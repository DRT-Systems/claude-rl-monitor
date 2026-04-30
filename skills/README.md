# claude-rl-monitor — skills

Claude Code skills. Drop a directory into `~/.claude/skills/` and Claude can invoke its `SKILL.md` via the `Skill` tool.

## Files

| Skill | Purpose |
|---|---|
| `budget-check/SKILL.md` | Planning-side budget query for the `budget-orchestrator` agent. Returns current 5h / 7d / Sonnet utilization, headroom, max safe subagent count, reset countdowns, and pending-checkpoint count. Pairs with [`hooks/rl-budget.js`](../hooks/rl-budget.js) and [`hooks/rl-checkpoint.js`](../hooks/rl-checkpoint.js). |

## Install

```bash
mkdir -p ~/.claude/skills/budget-check
cp budget-check/SKILL.md ~/.claude/skills/budget-check/
```

Verify:

```bash
ls ~/.claude/skills/budget-check/SKILL.md
```

The skill name (`budget-check`) appears in the available skills list at the start of any Claude Code session.

## When to use

Invoke `budget-check` BEFORE any `Task` tool call in a long-running workflow. The skill returns a JSON-shaped decision the orchestrator agent uses to choose between `PLAN`, `EXECUTE`, `RESUME`, and `DEFER` modes.

## Decision matrix

| Situation | Action |
|---|---|
| `available: true` AND no checkpoints | Spawn up to `max_subagents` new subagents |
| `available: true` AND checkpoints exist | Resume from oldest checkpoint first, then spawn new |
| `available: false` (5h or 7d ≥ threshold) | Do NOT spawn — work directly without `Task`, or save and stop |
| `headroom.five_hour < 20` (yellow zone) | Spawn but include `CHECKPOINT_AFTER_EVERY_STEP=1` in the subagent prompt |
| `stale: true` | Cache is older than 15 min — open VS Code briefly to refresh, or proceed with a wider safety margin |

## Pairing

The skill is the **planning** side. The matching **enforcement** side is the [`rl-gate.js`](../hooks/rl-gate.js) hook (`PreToolUse(Task)`), which hard-blocks at 85% regardless of what the skill returned. The skill's job is to plan well enough that the gate never fires.
