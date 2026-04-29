# claude-rl-monitor — VS Code extension

Status bar item showing Claude Pro / Max usage in real time.

```
✓ 5h:38%  7d:33%  ↺1h30m
```

## Build and install

```bash
npm install -g @vscode/vsce
cd vscode-extension
vsce package --allow-missing-repository
code --install-extension claude-rl-monitor-1.1.0.vsix
```

Reload window: `Ctrl+Shift+P` → `Developer: Reload Window`.

## Settings

| Key | Default | Description |
|---|---|---|
| `claudeRlMonitor.pollIntervalSeconds` | 300 | Min 120 — usage endpoint rate-limits aggressive polling. |
| `claudeRlMonitor.credentialsPath` | `""` | Override path to `.credentials.json`. Empty = `~/.claude/.credentials.json`. |

## How it works

Every poll, fetches `https://api.anthropic.com/api/oauth/usage` with the OAuth token from `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`. Renders 5-hour, 7-day, and 7-day Sonnet utilization with reset countdowns.

On HTTP 429, honors `Retry-After` and shows cached data to avoid flapping.

## Attribution

Pattern adapted from [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline) (MIT). See repo root [README.md](../README.md) for the full credits table.
