# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-04-29

### VS Code extension — `1.2.1` (no code change, packaging only)

### Added
- Bundled `README.md` and `CHANGELOG.md` inside the VSIX so VS Code's Extensions view shows them on the extension's detail page.
- `repository`, `homepage`, `bugs`, and `license` fields in `package.json` so the marketplace UI links resolve correctly.

## [0.2.1] — 2026-04-29

### VS Code extension — `1.2.1`

### Fixed
- **HTTP 401 from `/api/oauth/usage`** — Anthropic now requires the `anthropic-beta: oauth-2025-04-20` header in addition to `Authorization: Bearer <token>`. Without it, the endpoint returns `{"type":"authentication_error","message":"OAuth authentication is currently not supported."}`. Header is now sent on every request. The endpoint URL and response shape are unchanged.

### Notes
- The misleading 401 message ("OAuth authentication is currently not supported") really means "OAuth requires the beta header." Anthropic has not documented this.
- Source: research thread checked against `ohugonnot/claude-code-statusline`, `bartleby/claude-statusline`, `allthingsclaude/bar`, `taras-mrtn/ccbar` — all carry the same beta header.

## [0.2.0] — 2026-04-29

### VS Code extension — `1.2.0`

### Added
- **Disk cache** at `~/.claude/.rl_cache.json` (1-hour TTL) so the status bar shows last-known-good data immediately on activation, even if VS Code was reloaded or the endpoint is currently rate-limiting.
- **Staggered first poll** (5s after activation) to avoid all VS Code windows hitting the endpoint simultaneously when multiple windows are opened or restored.
- **Soft cooldown UI** when no cache exists and the endpoint returns HTTP 429 — shows `$(clock) Claude RL: cooling down (Nm)` with normal background instead of a hard error.

### Changed
- **Default backoff on HTTP 429** bumped from 5 minutes to 10 minutes when the endpoint does not provide a `Retry-After` header. The community usage endpoint appears to have aggressive throttling and 5 minutes was not long enough.
- Activation no longer shows "Loading…" if cached data is available; renders cached data instantly.

### Notes
The flag-file bridge for the Claude Code CLI hooks (`~/.claude/.rl_warn`) is unchanged in this release.

## [0.1.0] — 2026-04-29

### Added
- **VS Code extension** (`vscode-extension/`) — status bar item showing 5-hour, 7-day, and 7-day Sonnet usage with reset countdown. Polls `api.anthropic.com/api/oauth/usage` using the OAuth token from `~/.claude/.credentials.json`. Default poll 300s, configurable 120–1800s. HTTP 429 backoff honors `Retry-After`. Cache-on-failure prevents status bar flapping.
- **`hooks/rl-statusline.js`** — `statusLine` hook for the Claude Code CLI. Renders `5h:NN% 7d:NN% ↺countdown` and inlines the [caveman](https://github.com/JuliusBrussee/caveman) plugin's mode indicator. Writes `~/.claude/.rl_warn` flag at ≥80% usage.
- **`hooks/rl-warn.js`** — `UserPromptSubmit` hook. Injects a warning into Claude's context when the rate-limit flag is set. 10-minute auto-snooze between warnings.
- **`hooks/rl-stop-failure.js`** — `StopFailure(rate_limit)` hook. Parses the current session JSONL → extracts active todos and recently modified files → writes `~/.claude/rl-handoff.json` for the next session to pick up. Sends a Windows balloon notification.
- **`hooks/rl-session-start.js`** — `SessionStart(startup)` hook. Replays a saved handoff (<8h old, same project) into the new session via `additionalContext` injection, then deletes the handoff file (one-shot).
- **`docs/settings-example.json`** — snippet to merge into `~/.claude/settings.json` to wire all four hooks.
- README, LICENSE (MIT), `.gitignore`, sub-READMEs for `vscode-extension/` and `hooks/`.

### Attribution
Patterns and the OAuth usage endpoint discovery come from three upstream projects, all MIT-licensed:
- [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline)
- [`elb-pr/claudikins-automatic-context-manager`](https://github.com/elb-pr/claudikins-automatic-context-manager)
- [`karthiknitt/smart_resume`](https://github.com/karthiknitt/smart_resume)

Per-file `// Adapted from:` headers and the README credits table identify which patterns came from which project.
