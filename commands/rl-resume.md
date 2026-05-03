---
description: List pending rl-sessions checkpoints for the current project and route a chosen one to the budget-orchestrator agent for resumption.
argument-hint: "[checkpoint-id]"
---

# /rl-resume

Resume work suspended by a prior rate-limit block.

## Step 1 — pick a checkpoint

If `$ARGUMENTS` is set, treat it as `<id>` and skip listing. Otherwise list:

```bash
node ~/.claude/hooks/rl-checkpoint.js list
```

Output is filtered to the current project. Default to the **oldest** entry.

## Step 2 — inspect

```bash
node ~/.claude/hooks/rl-checkpoint.js show <id>
```

Show the user the `task_description`, `blocked_reason`, `resume_after`, and the saved `payload.next_steps`.

## Step 3 — route to the orchestrator

Invoke the **budget-orchestrator** agent in **resume** mode with the checkpoint payload. Do not call `Task` directly:

```text
Task(subagent_type="budget-orchestrator",
     prompt="RESUME mode. Checkpoint <id> is pending for this project.

      1. Run INIT (rl-budget → rl-checkpoint list → rl-memory-bank read).
      2. Pick checkpoint <id> via `rl-checkpoint.js show <id>`.
      3. Dispatch a Task with the original subagent_type (or `general-purpose`
         if unknown) and paste the checkpoint payload under a
         `RESUME FROM PRIOR CHECKPOINT` header. Tell it to pick up from the
         saved `next_steps`.
      4. On success, run `rl-checkpoint.js consume <id>`.
      5. Append a one-line entry to `memory-bank/progress.md` recording the
         resumption.

      Full payload:
      <paste the JSON from Step 2>
     ")
```

## Notes

- This command never calls `CronCreate` — that is the orchestrator's job when it decides to defer further. This command only restarts work.
- If the budget gate fires during resume, the orchestrator must save a *new* checkpoint and surface it via `rl-schedule-resume.js prepare` again. The original consumed checkpoint stays consumed.
- The SessionStart hook (`rl-session-start.js`) automatically surfaces pending checkpoints on every fresh session — `/rl-resume` is the manual override when that auto-surface is dismissed or when multiple checkpoints need triage.
