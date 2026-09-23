# ADR-0003: Session and agent liveness from process registry and transcript signals

**Date**: 2026-09-23
**Status**: accepted
**Deciders**: Wim (DRT Systems), Claude

## Context

The Agent Map ([ADR-0002](0002-agent-map-vscode-extension.md)) must show active sessions and agents in green.
The first rule ("transcript written in the last 90s") showed open-but-idle sessions and agents busy with long
tool calls as grey. Background agents get their `tool_result` at launch, so the parent's result does not
mean the agent finished. Agents started by an orchestrator get no completion notice at all.

## Decision

- **Session** is active while its process is alive: `~/.claude/sessions/<pid>.json` → `process.kill(pid, 0)`.
  Open sessions are shown even when older than 24h.
- **Agent** state, first match wins:
  1. session closed → grey
  2. `<task-notification>` with `<task-id>=agentId` in any transcript of the session → its `<status>`
  3. last user/assistant turn is assistant text with no `tool_use`, untouched for 15s → completed
  4. no transcript write for 10 min → "stopped (no activity)"
  5. otherwise running (green)
- A parent without its own notification inherits "running" from running children.

## Alternatives Considered

### Transcript mtime within 90s
- **Pros**: trivial
- **Cons**: idle sessions and long tool calls show as grey
- **Why not**: observed wrong in practice

### Parent's tool_result for the agent's toolUseId
- **Pros**: authoritative for foreground agents
- **Cons**: background agents get "Async agent launched" immediately
- **Why not**: observed on all 14 agents of a real session

### Agents write heartbeats to the board
- **Pros**: exact
- **Cons**: needs cooperation from every agent
- **Why not**: the transcript signals already cover most cases

## Consequences

### Positive
- Open sessions stay green while waiting for input; finished orchestrators turn grey right away via
  their notification

### Negative
- A single tool call longer than 10 min shows as stopped (`STALE_MS`, adjustable)
- Orphaned depth-2 agents show "stopped", never "completed"

### Risks
- Pid reuse after a crash could mark a dead session alive → low; the file also holds `procStart`, which
  could be checked if this happens
