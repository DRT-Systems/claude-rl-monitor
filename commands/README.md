# claude-rl-monitor — slash commands

User-invocable slash commands that complement the hooks and the `budget-orchestrator` agent.

## Install

```bash
mkdir -p ~/.claude/commands
cp *.md ~/.claude/commands/
```

After install, the listed commands are available in any Claude Code session.

## Files

| File | Trigger | Purpose |
|---|---|---|
| `rl-resume.md` | `/rl-resume [id]` | List pending rl-sessions checkpoints for the current project, optionally pick one by id, and route it to the `budget-orchestrator` agent in **resume** mode. Manual counterpart to the SessionStart hook's auto-surface. |

## Relationship to the rest of the system

```
rl-stop-failure.js  ──writes──▶  rl-handoff.json     ──┐
                                                       ├──▶  rl-session-start.js
rl-checkpoint.js    ──writes──▶  rl-sessions/*.json  ──┘     (SessionStart auto-surface)

rl-schedule-resume.js ─writes──▶ memory-bank/progress.md
                       emits ──▶ {wakeup, cron, recommendation}
                                 (caller surfaces choice to user, then feeds
                                  the chosen payload into ScheduleWakeup or
                                  CronCreate)

/rl-resume          ─reads───▶  rl-sessions/*.json
                     dispatches ▶ budget-orchestrator (resume mode)
```

The slash command and the SessionStart hook share the same source of truth (`~/.claude/rl-sessions/`); the hook is automatic, the slash command is explicit.
