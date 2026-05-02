# claude-rl-monitor — Claude Code hooks

Eight Node.js scripts for the Claude Code CLI, split across two responsibilities:

- **Visibility** (4 scripts) — show usage in the statusline, warn before the wall, save state when the wall is hit, replay state in the next session.
- **Orchestration** (4 scripts) — gate subagent dispatch on budget, query budget for planning, persist suspended-execution state, manage a Cline-style memory bank.

## Install

```bash
mkdir -p ~/.claude/hooks
cp *.js ~/.claude/hooks/
```

Then merge [`../docs/settings-example.json`](../docs/settings-example.json) into `~/.claude/settings.json`.

## Files — visibility

| File | Hook event | Purpose |
|---|---|---|
| `rl-statusline.js` | `statusLine` | Renders `[CAVEMAN] │ 5h:38% 7d:33% ↺1h30m` and writes `~/.claude/.rl_warn` at ≥80%. |
| `rl-warn.js` | `UserPromptSubmit` | Injects a warning into the next message when the flag is set. 10-min auto-snooze. |
| `rl-stop-failure.js` | `StopFailure(rate_limit)` | Parses session JSONL → saves handoff JSON → sends a Windows balloon notification. |
| `rl-session-start.js` | `SessionStart(startup)` | Injects saved handoff if <8h old for the same project, then deletes (one-shot). |

## Files — orchestration

| File | Hook event / invocation | Purpose |
|---|---|---|
| `rl-gate.js` | `PreToolUse(Task)` | Hard-blocks subagent spawn at 85% (5h or 7d). For Sonnet-typed subagents, also gates on the 7-day Sonnet bucket. Fail-open if cache missing/stale. Override via `CLAUDE_RL_GATE_DISABLED=1`. |
| `rl-budget.js` | CLI utility | Returns `{available, thresholds, current, headroom, max_subagents, resets_in, cache_age_minutes, stale, reasoning}` JSON. Used by the [`budget-check`](../skills/budget-check/SKILL.md) skill and the [`budget-orchestrator`](../agents/budget-orchestrator.md) agent for planning before any `Task` call. Fail-open with `available: true` if `~/.claude/.rl_cache.json` is missing. |
| `rl-checkpoint.js` | CLI utility | Suspended-execution ledger. Subcommands: `save` (stdin JSON), `list`, `show <id>`, `consume <id>`. Each record = `{id, created_at, project_dir, git: {branch, status}, payload}` where `payload` is the caller-supplied `{task_description, todos, files_modified, next_steps, blocked_reason, context, resume_after}`. `list` filters to the current `cwd`. Stored under `~/.claude/rl-sessions/<id>.json`. |
| `rl-memory-bank.js` | CLI utility | Cline-style 6-file memory bank. Subcommands: `init [path]`, `read [--all]`, `append <file>`. Files: `projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md` (the last two are "hot"; reload first on resume). |

## State files

All under `~/.claude/`:

| File / dir | Written by | Read by | TTL |
|---|---|---|---|
| `.rl_warn` | `rl-statusline.js` | `rl-warn.js` | until usage drops below 80% |
| `.rl_snooze` | `rl-warn.js` | `rl-warn.js` | 10 min |
| `rl-handoff.json` | `rl-stop-failure.js` | `rl-session-start.js` | 8 hours, one-shot, project-scoped |
| `.rl_cache.json` | VS Code extension | `rl-gate.js`, `rl-budget.js` | 1 hour (15 min stale threshold for the gate) |
| `rl-sessions/<id>.json` | subagent (via `rl-checkpoint.js save`) | `budget-orchestrator` (via `rl-checkpoint.js list/show/consume`) | until consumed |
| `<project>/memory-bank/*.md` | `rl-memory-bank.js append` | `rl-memory-bank.js read` | persistent in repo |

## Override knobs (env vars)

| Variable | Default | Used by |
|---|---|---|
| `CLAUDE_RL_THRESHOLD_5H` | 85 | `rl-gate.js`, `rl-budget.js` |
| `CLAUDE_RL_THRESHOLD_7D` | 85 | `rl-gate.js`, `rl-budget.js` |
| `CLAUDE_RL_THRESHOLD_SONNET` | 85 | `rl-gate.js`, `rl-budget.js` |
| `CLAUDE_RL_PER_AGENT_5H_PCT` | 5 | `rl-budget.js` (used to compute `max_subagents`) |
| `CLAUDE_RL_GATE_DISABLED` | (unset) | `rl-gate.js` — set to `1` to bypass the gate entirely |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | all hooks (overrides Claude Code config root) |

## Sonnet field limitation (CLI only)

Claude Code's `statusLine` JSON input exposes `rate_limits.five_hour` and `rate_limits.seven_day` but **not** `rate_limits.seven_day_sonnet` as of v2.1.119 (verified 2026-04-29). The hook is forward-compatible — it reads `seven_day_sonnet.used_percentage` and renders `Sonnet:NN%` when present. Until Claude Code emits that field, the CLI bar will only show 5h + 7d.

The VS Code extension does not have this limitation — it polls the OAuth usage endpoint directly which always returns Sonnet utilization. The orchestrator gate also has access to Sonnet headroom because the VS Code extension's cache is the data source.

## Caveman compatibility

`rl-statusline.js` inlines the [caveman](https://github.com/JuliusBrussee/caveman) plugin's mode indicator by reading `~/.claude/.caveman-active` directly — no PowerShell subprocess needed. If you don't use caveman, the indicator is silently skipped.

## Attribution

Patterns adapted from:
- [`elb-pr/claudikins-automatic-context-manager`](https://github.com/elb-pr/claudikins-automatic-context-manager) — flag-file bridge, handoff capture
- [`cline/cline`](https://github.com/cline/cline) — 6-file memory bank hierarchy (`rl-memory-bank.js`)
- [`GreatScottyMac/context-portal`](https://github.com/GreatScottyMac/context-portal) — strategy-file pattern (referenced by the orchestrator agent)

See repo root [README.md](../README.md) for the full credits table.
