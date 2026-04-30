# claude-rl-monitor — agents

Claude Code subagent definitions. Drop into `~/.claude/agents/` and they become invokable as `Task(subagent_type="<name>", ...)`.

## Files

| Agent | Purpose |
|---|---|
| `budget-orchestrator.md` | Rate-limit-aware subagent orchestrator. Runs an INIT → PLAN → EXECUTE → CHECKPOINT → RESUME protocol. Reads budget from `~/.claude/.rl_cache.json`, lists pending checkpoints from `~/.claude/rl-sessions/`, reads project state from `memory-bank/`, and only spawns subagents when there is headroom. Subagent prompts include a checkpoint instruction so a mid-flight gate trip auto-saves todos + state. |

## Install

```bash
mkdir -p ~/.claude/agents
cp budget-orchestrator.md ~/.claude/agents/
```

Verify it's registered:

```bash
ls ~/.claude/agents/budget-orchestrator.md
```

In a Claude Code session, `budget-orchestrator` will appear in the available `subagent_type` list.

## Routing rule

If you also install the global rule from this repo into `~/.claude/rules/common/agents.md` (the `CRITICAL` section), every `Task` dispatch is automatically routed through `budget-orchestrator`. Without that rule, you have to invoke it explicitly:

```
Use the budget-orchestrator agent. Task: <work description>.
```

## Protocol summary

The agent file is the source of truth. High-level:

1. **INIT** (every session start)
   - `node ~/.claude/hooks/rl-budget.js`
   - `node ~/.claude/hooks/rl-checkpoint.js list`
   - `node ~/.claude/hooks/rl-memory-bank.js read`
2. **PLAN** — break the user request into N independent subagent tasks; pick batch size from `max_subagents`.
3. **EXECUTE** — spawn each subagent with the work description plus the checkpoint protocol prompt template.
4. **CHECKPOINT** — if a subagent returns `CHECKPOINTED <id>`, update `progress.md` and transition to DEFER.
5. **RESUME** — on a future session, oldest pending checkpoint first; spawn a subagent with the checkpoint payload, consume after success.
6. **DEFER** — when budget exhausted, snapshot orchestrator state and tell the user when to resume.

## Hard rules

- Never call `Task` without first running step 1 of INIT.
- Never silently swallow a `[rl-gate] BLOCKED` error — translate it into a checkpoint + resume plan.
- The `rl-gate` hook is the floor (hard-blocks at 85%). The orchestrator's job is to plan well enough that the gate never fires.

## Prior art

- [`cline/cline`](https://github.com/cline/cline) — 6-file memory-bank hierarchy
- [`GreatScottyMac/context-portal`](https://github.com/GreatScottyMac/context-portal) — strategy-file pattern (system-prompt-mandated init+update)
- [`alioshr/memory-bank-mcp`](https://github.com/alioshr/memory-bank-mcp) — filesystem-isolation pattern for memory state

The suspended-execution ledger (`rl-checkpoint.js`) is a gap that none of these prior projects fills — they capture *project* state, not *in-flight task* state.

## Customization

Override default thresholds via env vars (see [`../hooks/README.md`](../hooks/README.md) for the full list):

```bash
export CLAUDE_RL_THRESHOLD_5H=80          # gate fires at 80% instead of 85%
export CLAUDE_RL_PER_AGENT_5H_PCT=8       # estimate each subagent at 8% of 5h budget
```
