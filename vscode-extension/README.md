# claude-rl-monitor — VS Code extension

Status bar item showing Claude Pro / Max usage in real time.

```
✓ 5h:38%  7d:33%  ↺1h30m
```

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
npx vsce package
code --install-extension claude-rl-monitor-$(node -p "require('./package.json').version").vsix
```

`npx vsce package` produces `claude-rl-monitor-<version>.vsix` using the `version` field in `package.json`. The `*.vsix` artifact is gitignored — rebuild whenever needed.

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

On HTTP 429, honors `Retry-After` and shows cached data to avoid flapping.

## Attribution

Pattern adapted from [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline) (MIT). See repo root [README.md](../README.md) for the full credits table.
