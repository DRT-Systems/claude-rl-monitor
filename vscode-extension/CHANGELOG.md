# Changelog — VS Code extension

## [1.2.2] — 2026-04-29

### Added
- Status bar text now also displays `Sonnet:NN%` for the 7-day Claude Sonnet utilization, matching the `Account & Usage` panel in the Claude Code UI. Was previously visible in the tooltip only.

## [1.2.1] — 2026-04-29

### Fixed
- HTTP 401 from `/api/oauth/usage`. Anthropic now requires `anthropic-beta: oauth-2025-04-20` header alongside the OAuth bearer token. Without it, the endpoint returns `{"type":"authentication_error","message":"OAuth authentication is currently not supported."}`. Header is now sent on every request.

## [1.2.0] — 2026-04-29

### Added
- Disk cache at `~/.claude/.rl_cache.json` (1-hour TTL) — status bar shows last-known-good data immediately on activation, even after VS Code reload or while the endpoint is rate-limiting.
- Staggered first poll (5s after activation) — avoids burst at startup when multiple windows activate simultaneously.
- Soft cooldown UI when no cache + HTTP 429 — shows `$(clock) Claude RL: cooling down (Nm)` with normal background instead of red error.

### Changed
- Default backoff on HTTP 429 bumped from 5 min → 10 min when no `Retry-After` header is provided.
- Activation no longer shows "Loading…" if cached data is available.

## [1.1.0] — 2026-04-29

### Changed
- Default `pollIntervalSeconds` raised from 60 → 300; minimum from 30 → 120. The usage endpoint rate-limits aggressive polling.
- HTTP 429 now honors `Retry-After` header and falls back to a default backoff window.
- Cache last successful response in memory; show cached data with a warning instead of a hard error on transient failures.

## [1.0.0] — 2026-04-29

### Added
- Initial release.
- Status bar item showing 5-hour, 7-day, and 7-day Sonnet utilization with reset countdown.
- Polls `https://api.anthropic.com/api/oauth/usage` using OAuth token from `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`.
- Color-coded thresholds: green <50%, blue (`$(pulse)`) ≥50%, yellow ≥80%, red ≥90%.
- Click status bar to force refresh.
- Configuration: `claudeRlMonitor.pollIntervalSeconds`, `claudeRlMonitor.credentialsPath`.
