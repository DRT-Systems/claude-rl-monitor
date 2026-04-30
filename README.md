# claude-rl-monitor

> **This project reuses code and design ideas from the following repositories. None of the work in this repo would exist without them.**
>
> | Source repo | License | What we took | Where it lives here |
> |---|---|---|---|
> | [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline) | MIT | OAuth usage endpoint discovery (`api.anthropic.com/api/oauth/usage`), token path (`~/.claude/.credentials.json` → `claudeAiOauth.accessToken`), color-threshold + countdown rendering, cache-on-failure pattern. | [`vscode-extension/extension.js`](vscode-extension/extension.js), [`hooks/rl-statusline.js`](hooks/rl-statusline.js) |
> | [`elb-pr/claudikins-automatic-context-manager`](https://github.com/elb-pr/claudikins-automatic-context-manager) | MIT | Two-phase flag-file bridge (`statusLine` writes flag → `UserPromptSubmit` reads flag), handoff-state JSON shape, snooze/dismiss state pattern, session-JSONL parsing for active todos + modified files. | [`hooks/rl-statusline.js`](hooks/rl-statusline.js), [`hooks/rl-warn.js`](hooks/rl-warn.js), [`hooks/rl-stop-failure.js`](hooks/rl-stop-failure.js), [`hooks/rl-session-start.js`](hooks/rl-session-start.js) |
> | [`karthiknitt/smart_resume`](https://github.com/karthiknitt/smart_resume) (paired with [DEV.to article](https://dev.to/karthikeyan_natarajan_1cb/i-built-a-shell-wrapper-that-makes-claude-code-auto-resume-after-rate-limits-2lje)) | MIT | `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` JSON shape from `statusLine` input, `Retry-After` header handling, reset-epoch parsing. | [`vscode-extension/extension.js`](vscode-extension/extension.js), [`hooks/rl-statusline.js`](hooks/rl-statusline.js) |
> | [`cline/cline`](https://github.com/cline/cline) | Apache-2.0 | The 6-file memory-bank hierarchy: `projectbrief → productContext / systemPatterns / techContext → activeContext → progress`. Replicated by [`hudrazine/claude-code-memory-bank`](https://github.com/hudrazine/claude-code-memory-bank), [`alioshr/memory-bank-mcp`](https://github.com/alioshr/memory-bank-mcp), [`ipospelov/mcp-memory-bank`](https://github.com/ipospelov/mcp-memory-bank). | [`hooks/rl-memory-bank.js`](hooks/rl-memory-bank.js), [`agents/budget-orchestrator.md`](agents/budget-orchestrator.md) |
> | [`GreatScottyMac/context-portal`](https://github.com/GreatScottyMac/context-portal) | MIT | The "strategy file" pattern — system-prompt-mandated init+update sequences that force the model to read state at session start and write back at session end. | [`agents/budget-orchestrator.md`](agents/budget-orchestrator.md) |
>
> Every source file in this repo also includes an `// Adapted from:` header comment with the same attribution at the file level. See [Credits](#credits-and-prior-art) below for context.
>
> **This is not a fork.** The VS Code extension and the four hook scripts were written from scratch, but the architecture and the endpoint knowledge come from the projects above.

Monitor Claude Pro / Max usage limits (5-hour session + 7-day weekly) and orchestrate context handoff when limits are hit.

Three complementary layers:

| Component | Purpose |
|---|---|
| **vscode-extension/** | Status bar item in VS Code showing live 5h / 7d / Sonnet usage with countdown to reset. |
| **hooks/** (visibility) | Claude Code CLI hooks: render statusline, warn at 80%, capture handoff state on `StopFailure(rate_limit)`, restore it on `SessionStart`. |
| **hooks/** + **skills/** + **agents/** (orchestration) | Budget-aware subagent orchestrator. Hard-blocks `Task` calls at 85%, plans batch sizes from headroom, instructs subagents to checkpoint state when budget gets tight, replays checkpoints after the rate-limit window resets. |

Works with Claude Pro and Max plans (OAuth auth) — does **not** require an API key.

## Quickstart

```bash
git clone https://github.com/DRT-Systems/claude-rl-monitor.git
cd claude-rl-monitor

# Hooks + skill + agent
mkdir -p ~/.claude/hooks ~/.claude/skills/budget-check ~/.claude/agents
cp hooks/*.js                     ~/.claude/hooks/
cp skills/budget-check/SKILL.md   ~/.claude/skills/budget-check/
cp agents/budget-orchestrator.md  ~/.claude/agents/

# Merge docs/settings-example.json into ~/.claude/settings.json
# (statusLine, UserPromptSubmit, StopFailure, SessionStart, PreToolUse(Task))

# VS Code extension
cd vscode-extension
npm install -g @vscode/vsce
vsce package
code --install-extension claude-rl-monitor-*.vsix
```

Reload VS Code window. Restart any open Claude Code CLI sessions.

In any Claude Code session, kick off the orchestrator:

```
Use the budget-orchestrator agent. Task: <multi-step work description>.
```

Or — if you also install the global rule (`~/.claude/rules/common/agents.md`) from this repo's [agents/README.md](agents/README.md) — every `Task` dispatch is auto-routed through `budget-orchestrator` without you having to ask.

---

## Why

Anthropic does not yet expose a `ContextThreshold` hook (see [issue #25689](https://github.com/anthropics/claude-code/issues/25689)) and the official `StopFailure` hook fires for side effects only — it cannot block or auto-resume.

This repo fills the gap with two minimal-footprint components:

1. **Visibility:** see how much of your 5-hour session and weekly quota you've used, in real time, in VS Code's status bar.
2. **Continuity:** when you do hit the wall, your active todos + recently modified files + objective are persisted to `~/.claude/rl-handoff.json`. The next fresh `claude` session in the same project picks them up automatically.

---

## Sub-READMEs

Per-component READMEs hold the details:

| Directory | Covers |
|---|---|
| [`vscode-extension/README.md`](vscode-extension/README.md) | Extension build, install, settings, polling behavior |
| [`hooks/README.md`](hooks/README.md) | All 8 hooks (visibility + orchestration), state files, env-var override knobs |
| [`skills/README.md`](skills/README.md) | The `budget-check` skill and decision matrix |
| [`agents/README.md`](agents/README.md) | The `budget-orchestrator` agent and its protocol |

### Caveat — Claude Pro auth and the statusLine hook

The `statusLine` hook receives `rate_limits` data only when Claude Code emits it. With Claude Pro / Max OAuth auth, this is reliable on Claude Code v2.1.80+. If you authenticate with an API key, token counts are exposed differently and the hook still works. If neither exposes the data, the bar stays empty but does not error.

The `seven_day_sonnet` field is **not** in the statusLine input as of Claude Code v2.1.119 — only the VS Code extension (which polls the OAuth endpoint directly) sees it. Once Anthropic adds it to the statusLine input, the CLI hook will render it automatically.

---

## Budget-aware subagent orchestration

Beyond visibility, the repo ships a complete orchestration layer for keeping long workflows inside the rate-limit budget. Three pieces work together:

| Piece | Type | What it does |
|---|---|---|
| [`hooks/rl-gate.js`](hooks/rl-gate.js) | `PreToolUse(Task)` hook | Hard-blocks subagent spawn at 85% (5h or 7d). Reads the same `~/.claude/.rl_cache.json` the VS Code extension writes. Fail-open if cache is missing. |
| [`skills/budget-check/SKILL.md`](skills/budget-check/SKILL.md) | Skill | Planning-side query. Returns current usage, headroom, max safe subagents, and pending-checkpoint count. Pairs with [`hooks/rl-budget.js`](hooks/rl-budget.js). |
| [`agents/budget-orchestrator.md`](agents/budget-orchestrator.md) | Agent definition | Strict init→plan→execute→checkpoint→resume protocol. Uses the [Cline 6-file memory-bank hierarchy](https://github.com/cline/cline) for project state and [`hooks/rl-checkpoint.js`](hooks/rl-checkpoint.js) for suspended-execution state. |

Together they answer "build me an agent that orchestrates subagents only when there's budget, and gracefully resumes after the rate-limit window resets." See the agent file for the full protocol.

## Repo layout

```
claude-rl-monitor/
├── README.md                      ← this file
├── CHANGELOG.md
├── LICENSE                        ← MIT
├── vscode-extension/
│   ├── extension.js
│   ├── package.json
│   ├── README.md                  ← extension docs
│   └── CHANGELOG.md
├── hooks/
│   ├── rl-statusline.js           ← terminal statusLine
│   ├── rl-warn.js                 ← UserPromptSubmit warning at >=80%
│   ├── rl-stop-failure.js         ← StopFailure(rate_limit) handoff
│   ├── rl-session-start.js        ← SessionStart handoff replay
│   ├── rl-gate.js                 ← PreToolUse(Task) hard block at 85%
│   ├── rl-budget.js               ← budget query utility
│   ├── rl-checkpoint.js           ← suspended-execution ledger
│   ├── rl-memory-bank.js          ← Cline 6-file hierarchy
│   └── README.md                  ← hooks docs
├── skills/
│   ├── budget-check/SKILL.md
│   └── README.md                  ← skills docs
├── agents/
│   ├── budget-orchestrator.md
│   └── README.md                  ← agents docs
└── docs/
    └── settings-example.json      ← snippet to merge into ~/.claude/settings.json
```

---

## Compatibility

- **Claude Code:** v2.1.80+ (for the `rate_limits` field in statusLine input)
- **Node.js:** v18+ (uses `node:https`, no external deps)
- **VS Code:** v1.80+
- **OS:** Windows (PowerShell toast in StopFailure hook), macOS / Linux untested but the statusLine + warn + session-start hooks are pure Node.js and should work; the StopFailure hook's notification path is Windows-specific and can be swapped for `osascript` / `notify-send`.

---

## Credits and prior art

This project is a **synthesis of three community projects**. Nothing here is novel architecture — the value is combining them into a single working setup for VS Code + Claude Code on Windows with Claude Pro auth.

### 1. [`ohugonnot/claude-code-statusline`](https://github.com/ohugonnot/claude-code-statusline) (MIT)
**Used for:** the OAuth usage endpoint discovery (`https://api.anthropic.com/api/oauth/usage`), the OAuth token location (`~/.claude/.credentials.json` → `claudeAiOauth.accessToken`), the percentage-bar rendering pattern, and the cache + atomic-write approach.

The VS Code extension (`vscode-extension/extension.js`) is a JavaScript/TypeScript reimplementation of the polling logic from ohugonnot's bash `statusline.sh`. Without their endpoint discovery, this whole project would not work for Pro auth.

### 2. [`elb-pr/claudikins-automatic-context-manager`](https://github.com/elb-pr/claudikins-automatic-context-manager) (MIT)
**Used for:** the flag-file bridge (`~/.claude/.rl_warn`) between the `statusLine` hook (which sees percentages but cannot inject prompts) and the `UserPromptSubmit` hook (which can inject but does not see token data), the handoff-state JSON format, and the snooze/dismiss state pattern.

The hooks `rl-statusline.js`, `rl-warn.js`, and `rl-stop-failure.js` follow claudikins' two-phase pattern: statusline writes flag, hook reads flag and injects context.

### 3. [DEV.to article by karthiknitt — "Shell Wrapper That Makes Claude Code Auto-Resume After Rate Limits"](https://dev.to/karthikeyan_natarajan_1cb/i-built-a-shell-wrapper-that-makes-claude-code-auto-resume-after-rate-limits-2lje) ([source](https://github.com/karthiknitt/smart_resume))
**Used for:** the `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` JSON shape from the `statusLine` hook input (which Claude Code v2.1.80+ now emits natively — this article documented it), reset-epoch parsing, and the `Retry-After` backoff approach on HTTP 429.

The auto-resume wrapper from this article (`claude-smart-resume.sh`) is **not** included here because it requires a wrapped CLI binary, which does not work with the VS Code extension. We use the `StopFailure(rate_limit)` hook + Windows toast + `SessionStart` handoff replay instead.

---

Each source file in this repo includes an `// Adapted from:` comment pointing at the specific upstream component its design was taken from. If you are looking to extend any one piece, read the upstream project — it almost certainly has more depth than what we ported here.

## License

MIT — see [LICENSE](LICENSE).
