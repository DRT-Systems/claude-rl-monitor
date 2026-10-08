# Product

## Register
product

## Users & purpose
A single developer running many Claude Code sessions and subagents at once. The Agent Map (VS Code webview, `vscode-agent-map/`) is glanced at while agents work: what is running, what is stuck or waiting, what is burning tokens — then drill into one agent (activity, prompt, tool calls, transcript) and act on it (pause, stop, open session).

## Personality
Lively, bold, status-forward. Status is the loudest signal on screen: running / waiting / paused / done / stopped must read in under a second, in dark and light VS Code themes.

## Anti-references
- Generic SaaS dashboard: big hero numbers, gradient accents, identical card grids.

## Constraints
- Colors come from VS Code theme tokens (`--vscode-*`) so every theme works; no hardcoded palette except as token fallbacks.
- Text contrast ≥ 4.5:1; status is never conveyed by color alone (label or glyph too).
