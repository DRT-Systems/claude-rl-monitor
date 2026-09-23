# ADR-0001: Advisory file claims with a shared board and consent log

**Date**: 2026-09-23
**Status**: accepted
**Deciders**: Wim (DRT Systems), Claude

## Context

Several Claude sessions on one machine dispatch subagents through the budget-orchestrator, often into the
same repo. Nothing recorded which session sent which agent to which files, so two agents could edit the same
file at once and overwrite each other. Rule: two agents may only work on the same file after they have
communicated.

## Decision

The orchestrator claims files before every dispatch via `hooks/rl-claims.js`. One machine-wide board lives in
`~/.claude/rl-claims/claims.json` (`claims[]`, `released[]`, `messages[]`). A conflicting claim fails
(exit 3) until the holder session approves an `ask` in the message log (`reply <id> approve`). Claims are
advisory: the orchestrator enforces them, and hooks do not block edits.

## Alternatives Considered

### Hard block via PreToolUse hook on Edit/Write
- **Pros**: agents physically cannot touch unclaimed files
- **Cons**: needs a way to map each tool call to a claim; false blocks stop legitimate work
- **Why not**: the user chose orchestrator-only enforcement; can be added later on the same board

### Direct SendMessage between agents
- **Pros**: native, no store
- **Cons**: only works inside one session; no record
- **Why not**: the conflicts that matter are between sessions

### Serial handoff only (wait until release)
- **Pros**: simplest
- **Cons**: blocks parallel work on large files that could be split
- **Why not**: a consent log lets the holder allow a split, and the note tells the agent where to stay out

### Board per project / inside rl-sessions/
- **Pros**: fewer entries to scan; reuses an existing folder
- **Cons**: sessions in different folders can touch the same files
- **Why not**: `rl-checkpoint.js list` reads every `*.json` in `rl-sessions/` and would list the board as a
  phantom checkpoint

## Consequences

### Positive
- A single overview (`rl-claims.js list`, statusline `claims:N asks:M`, SessionStart 🔒 block)
- Sharing is explicit and auditable (who asked, who approved, with what note)

### Negative
- Advisory: a subagent that ignores the prompt can still edit unclaimed files
- Asks are only answered when the holder's orchestrator runs INIT, or by hand with `reply`
- Directories match as exact paths, not prefixes

### Risks
- Dead sessions hold claims → claims auto-expire after 24h
- Concurrent writers → lockfile plus atomic rename; a stale lock is broken after 10s
