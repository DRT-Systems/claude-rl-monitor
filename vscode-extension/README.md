# claude-rl-monitor — VS Code extension

Status bar item showing Claude Pro / Max usage in real time.

```
✓ 5h:38%  7d:33%  Sonnet:56%  ↺1h30m
```

Status icon and background color reflect the highest of the three percentages:

| Max % | Icon | Background |
|---|---|---|
| < 50 | `$(check)` | normal |
| ≥ 50 | `$(pulse)` | normal |
| ≥ 80 | `$(warning)` | warning |
| ≥ 90 | `$(error)` | error |

Click the status bar item to force a refresh. Hover for a per-window breakdown with reset countdowns and data age.

## Install

### From GitHub Releases (recommended)

1. Download the latest `claude-rl-monitor-<version>.vsix` from [Releases](https://github.com/DRT-Systems/claude-rl-monitor/releases).
2. Install:
   ```bash
   code --install-extension claude-rl-monitor-<version>.vsix
   ```
3. Reload window: `Ctrl+Shift+P` → `Developer: Reload Window`.

### Build from source

```bash
cd vscode-extension
npm install
npx vsce package
code --install-extension claude-rl-monitor-$(node -p "require('./package.json').version").vsix
```

`npx vsce package` produces `claude-rl-monitor-<version>.vsix` using the `version` field in `package.json`. The `*.vsix` artifact is gitignored — rebuild whenever needed.

### Recompile only (no install)

If you only want to rebuild the VSIX artifact:

```bash
cd vscode-extension
npm install
npx vsce package
```

On Windows PowerShell:

```powershell
Set-Location "c:\GitSync\claude-rl-monitor\vscode-extension"
npm install
npx vsce package
```

## Publish a release (maintainers)

1. Bump `version` in `vscode-extension/package.json` and add a CHANGELOG entry.
2. Commit and push.
3. Build: `cd vscode-extension && npx vsce package`
4. Tag and release:
   ```bash
   VERSION=$(node -p "require('./vscode-extension/package.json').version")
   git tag -a "v$VERSION" -m "v$VERSION"
   git push origin "v$VERSION"
   gh release create "v$VERSION" "vscode-extension/claude-rl-monitor-$VERSION.vsix" \
     --title "v$VERSION" --notes-from-tag
   ```

## Settings

| Key | Default | Description |
|---|---|---|
| `claudeRlMonitor.pollIntervalSeconds` | 300 | Min 120 — usage endpoint rate-limits aggressive polling. |
| `claudeRlMonitor.credentialsPath` | `""` | Override path to `.credentials.json`. Empty = `~/.claude/.credentials.json`. |

## How it works

Every poll, fetches `https://api.anthropic.com/api/oauth/usage` with the OAuth token from `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`. Renders 5-hour, 7-day, and 7-day Sonnet utilization with reset countdowns.

Required headers: `Authorization: Bearer <token>` plus `anthropic-beta: oauth-2025-04-20`. Without the beta header the endpoint returns HTTP 401 with the misleading message `OAuth authentication is currently not supported`.

### Resilience

- **Disk cache** at `~/.claude/.rl_cache.json` (1-hour TTL). Last-known-good data renders immediately on activation, even after VS Code reload or while the endpoint is rate-limiting. The same cache file is consumed by the [`rl-gate.js`](../hooks/rl-gate.js) and [`rl-budget.js`](../hooks/rl-budget.js) hooks — the extension is the single writer.
- **Staggered first poll** (5 s after activation) so simultaneous activations across multiple windows do not burst the endpoint.
- **HTTP 429 backoff** honors `Retry-After`; falls back to a 10-minute window when the header is absent. With cache, the bar keeps showing cached data with a tooltip note. Without cache, the bar shows `$(clock) Claude RL: cooling down (Nm)` instead of a hard error.

### Integration with ScheduleWakeup and CronCreate

The extension does not call schedulers directly, but it powers the scheduler path by keeping `~/.claude/.rl_cache.json` fresh for orchestration hooks.

- [`../hooks/rl-schedule-resume.js`](../hooks/rl-schedule-resume.js) prepares validated resume payloads for both `ScheduleWakeup` and `CronCreate`.
- [`../agents/budget-orchestrator.md`](../agents/budget-orchestrator.md) uses those payloads in DEFER mode to surface a scheduler choice with a recommendation.
- [`../commands/rl-resume.md`](../commands/rl-resume.md) provides manual resume via `/rl-resume` if a scheduled wakeup does not fire.

## Attribution

Pattern adapted from [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline) (MIT). See repo root [README.md](../README.md) for the full credits table.
