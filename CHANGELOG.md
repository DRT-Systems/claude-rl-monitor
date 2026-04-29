# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
