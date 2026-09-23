# ADR-0002: Agent Map as a VS Code webview extension reading Claude Code transcripts

**Date**: 2026-09-23
**Status**: accepted
**Deciders**: Wim (DRT Systems), Claude

## Context

We need a live overview like Claude Code's own "Agent map": session → agents → sub-agents, with running
time, tokens, claimed files and share requests, shown inside VS Code like the Welcome page.

## Decision

A separate VS Code extension, `vscode-agent-map/` (`drt-systems.claude-agent-map`), plain JS with no build
step. It polls every 4s and renders a webview panel plus a status-bar count. Data is read-only from Claude
Code's own files: `projects/<proj>/<session>.jsonl` (title, model, context tokens) and
`<session>/subagents/*.meta.json` + `*.jsonl` (type, description, `parentAgentId`, usage), joined with
the claims board ([ADR-0001](0001-advisory-file-claims.md)). A claim links to an agent when claim `task`
equals the Task `description`.

## Alternatives Considered

### Local web server (localhost page)
- **Pros**: any browser; simple to build
- **Cons**: must be started; uses a port
- **Why not**: the user wanted it inside VS Code

### Static HTML snapshot
- **Pros**: no running process
- **Cons**: must be regenerated to refresh
- **Why not**: not live

### claude.ai Artifact
- **Pros**: shareable, hosted
- **Cons**: cannot read local files
- **Why not**: the data would have to be pushed and would not be live

### Merge into the existing `vscode-extension/` (rate-limit monitor)
- **Pros**: one extension to install
- **Cons**: mixes concerns; the status-bar monitor grows
- **Why not**: different concern and release cycle

### Agents report their own state to the board
- **Pros**: explicit, format-independent
- **Cons**: needs cooperation from every agent
- **Why not**: transcripts already hold everything (tree, usage, timing)

## Consequences

### Positive
- Works for every agent, including ones not dispatched through the orchestrator
- No agent changes needed apart from matching the claim `task` to the Task `description`
- Collapsible tree (open sessions and running branches start expanded) keeps large sessions readable

### Negative
- Relies on undocumented Claude Code file formats, which may change between versions
- Tokens shown are the current context size, not cumulative spend
- Reads up to 512 KB of each transcript tail, and the whole file when scanning for notifications
  (cached by mtime/size)

### Risks
- A Claude Code update changes transcript layout → run `node extension.js` to self-check; the fields used
  are isolated in `summarize()`/`collect()`
