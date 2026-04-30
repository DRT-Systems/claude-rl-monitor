# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-04-30

### Documentation
- Top-level README: rewritten Quickstart that installs hooks + skill + agent + VS Code extension in one block. Replaced the two old "Install — VS Code" / "Install — Claude Code hooks" sections with a single "Sub-READMEs" pointer table.
- New `agents/README.md` covering the `budget-orchestrator` install, routing rule, protocol summary, hard rules, and customization knobs.
- New `skills/README.md` covering the `budget-check` skill, decision matrix, and pairing with the gate hook.
- `hooks/README.md` extended to cover all 8 hooks (4 visibility + 4 orchestration), the new state files (`.rl_cache.json`, `rl-sessions/`, `memory-bank/`), and the env-var override knobs.
- README clarifies that the `seven_day_sonnet` field is not in the statusLine input as of Claude Code v2.1.119 — only the VS Code extension sees it.

## [0.3.0] — 2026-04-29

### Added — budget-aware subagent orchestration
- **`hooks/rl-gate.js`** — new `PreToolUse(Task)` hook that hard-blocks subagent spawning when 5-hour or 7-day usage hits 85% (configurable). For Sonnet-typed subagents, also gates on the 7-day Sonnet bucket. Fail-open when the cache file is missing or stale (>15 min). Override via `CLAUDE_RL_THRESHOLD_5H`, `CLAUDE_RL_THRESHOLD_7D`, `CLAUDE_RL_THRESHOLD_SONNET`, `CLAUDE_RL_GATE_DISABLED` env vars.
- **`hooks/rl-budget.js`** — utility script that returns current usage, headroom, max-safe subagent count, reset countdowns, and a one-line reasoning string as JSON. Used by the budget-check skill and the orchestrator agent for planning.
- **`hooks/rl-checkpoint.js`** — suspended-execution ledger. `save` (stdin JSON), `list`, `show <id>`, `consume <id>`. Each checkpoint captures `task_description`, `todos`, `files_modified`, `next_steps`, `blocked_reason`, `resume_after`, plus repo branch and `git status --short`. Stored under `~/.claude/rl-sessions/`.
- **`hooks/rl-memory-bank.js`** — Cline-style 6-file memory bank (`projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`). Commands: `init [path]`, `read [--all]`, `append <file>`. Captures *project* state — pairs with the checkpoint ledger which captures *suspended-execution* state.
- **`skills/budget-check/SKILL.md`** — planning skill the orchestrator invokes before every `Task` call. Returns `{available, current, headroom, max_subagents, resets_in, ...}` and the recommended action. Decision matrix for green / yellow / red zones.
- **`agents/budget-orchestrator.md`** — strict init→plan→execute→checkpoint→resume protocol agent. Adopts the strategy-file pattern from `GreatScottyMac/context-portal` (system-prompt-mandated init+update sequences) and the Cline 6-file memory bank from `cline/cline`. Includes a subagent prompt template that instructs subagents to call `rl-checkpoint.js save` if the gate fires mid-flight.
- **`docs/settings-example.json`** — adds the `PreToolUse(Task) → rl-gate.js` wiring.

### Prior art added to credits
- [`cline/cline`](https://github.com/cline/cline) (Apache-2.0) — 6-file memory-bank hierarchy.
- [`GreatScottyMac/context-portal`](https://github.com/GreatScottyMac/context-portal) (MIT) — strategy-file pattern for forced init/update.

### Notes
- This is a strict superset of the existing rate-limit visibility features. The original 4 hooks (`rl-statusline`, `rl-warn`, `rl-stop-failure`, `rl-session-start`) and the VS Code extension are unchanged.
- Default per-agent budget cost is 5% of the 5-hour window — override via `CLAUDE_RL_PER_AGENT_5H_PCT`. Tune up if you observe agents costing more.
- The orchestrator agent is opt-in: invoke it explicitly via `Task` with `subagent_type: budget-orchestrator`. The gate hook fires for all `Task` calls regardless.

## [0.2.5] — 2026-04-29

### Documented
- Claude Code v2.1.119 statusLine JSON input exposes only `rate_limits.five_hour` and `rate_limits.seven_day` — no `seven_day_sonnet`. Verified by dumping the live input shape. The CLI `rl-statusline.js` hook code is forward-compatible (reads the field if present) but the bar will only render `Sonnet:NN%` once Claude Code starts emitting it. The VS Code extension is unaffected — it polls the OAuth endpoint directly which does return Sonnet data. See `hooks/README.md`.

## [0.2.4] — 2026-04-29

### CLI hooks

### Added
- `hooks/rl-statusline.js` now reads `rate_limits.seven_day_sonnet.used_percentage` from the statusLine input and displays `Sonnet:NN%` between the `7d` and the countdown. Mirrors the VS Code extension v1.2.2 change. Field is optional — older Claude Code versions that do not emit it just fall through.

## [0.2.3] — 2026-04-29

### VS Code extension — `1.2.2`

### Added
- Status bar text now displays `Sonnet:NN%` (7-day Claude Sonnet utilization) alongside `5h:NN%` and `7d:NN%`. The data was already retrieved and shown in the tooltip — this just promotes it to the bar so it matches the `Account & Usage` panel.

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
