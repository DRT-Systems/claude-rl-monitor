# claude-rl-monitor — Claude Code hooks

Four hooks for the Claude Code CLI. Together they:

1. Display 5h / 7d usage in the terminal statusline (and write a flag file at ≥80%).
2. Inject a warning into your next message when the flag is set.
3. Save handoff state when a rate limit hits.
4. Restore handoff state in the next fresh session.

## Install

```bash
mkdir -p ~/.claude/hooks
cp *.js ~/.claude/hooks/
```

Then merge [`../docs/settings-example.json`](../docs/settings-example.json) into `~/.claude/settings.json`.

## Files

| File | Hook event | Purpose |
|---|---|---|
| `rl-statusline.js` | `statusLine` | Render `[CAVEMAN] │ 5h:38% 7d:33% ↺1h30m`, write `~/.claude/.rl_warn` at ≥80%. |
| `rl-warn.js` | `UserPromptSubmit` | Inject warning when flag set. 10-min auto-snooze. |
| `rl-stop-failure.js` | `StopFailure(rate_limit)` | Parse session JSONL → save handoff JSON → Windows toast. |
| `rl-session-start.js` | `SessionStart(startup)` | Inject saved handoff if <8h old, then delete. |

## State files

All under `~/.claude/`:

| File | Written by | Read by | TTL |
|---|---|---|---|
| `.rl_warn` | `rl-statusline.js` | `rl-warn.js` | until usage drops below 80% |
| `.rl_snooze` | `rl-warn.js` | `rl-warn.js` | 10 min |
| `.rl_dismiss` | (manual) | `rl-warn.js` | until session end |
| `rl-handoff.json` | `rl-stop-failure.js` | `rl-session-start.js` | 8 hours, one-shot |

## Sonnet field limitation (CLI only)

Claude Code's `statusLine` JSON input exposes `rate_limits.five_hour` and `rate_limits.seven_day` but **not** `rate_limits.seven_day_sonnet` as of v2.1.119 (verified 2026-04-29). The hook is forward-compatible — it reads `seven_day_sonnet.used_percentage` and renders `Sonnet:NN%` when present. Until Claude Code emits that field, the CLI bar will only show 5h + 7d.

The VS Code extension does not have this limitation — it polls the OAuth usage endpoint directly which always returns Sonnet utilization.

## Caveman compatibility

`rl-statusline.js` inlines the [caveman](https://github.com/JuliusBrussee/caveman) plugin's mode indicator by reading `~/.claude/.caveman-active` directly — no PowerShell subprocess needed. If you don't use caveman, the indicator is silently skipped.

## Attribution

Patterns adapted from [`elb-pr/claudikins-automatic-context-manager`](https://github.com/elb-pr/claudikins-automatic-context-manager) (MIT). See repo root [README.md](../README.md) for full credits.
