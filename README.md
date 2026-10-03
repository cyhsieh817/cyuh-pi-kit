# cyuh-pi-kit

**Client-facing Pi pack.** One install → most day-to-day agent work runs to completion without babysitting.

> **Public subscribe pack.** Portable: no operator host paths, no herdr/Themis/fleet hooks, no secrets.
> Internal full stack stays in private **`cyuh-pi-suite`** (not for clients).

## Requirements

- [Pi](https://github.com/badlogic/pi-mono) / Pi coding-agent on PATH as `pi`
- **Git** on PATH (`git --version` works). Windows: install [Git for Windows](https://git-scm.com/download/win), then open a **new** terminal.

## Install (client machine)

**Recommended (public HTTPS — no GitHub login / SSH key):**

```bash
pi install -l https://github.com/cyhsieh817/cyuh-pi-kit.git
```

Equivalents:

```bash
pi install -l git:github.com/cyhsieh817/cyuh-pi-kit
pi install -l git:https://github.com/cyhsieh817/cyuh-pi-kit.git
```

SSH (only if the machine already has GitHub SSH set up):

```bash
pi install -l git:git@github.com:cyhsieh817/cyuh-pi-kit
```

User-wide (all projects on this machine) — omit `-l`:

```bash
pi install https://github.com/cyhsieh817/cyuh-pi-kit.git
```

### Update

```bash
pi update
```

Or re-run the same `pi install …` source after pulling new releases.

### After install

**Restart Pi** or `/reload`, then:

```text
/auto-continue status
/ctx-guard status
```

## What ships in v0.1

| Module | Role | Commands |
|---|---|---|
| **auto-continue** | Compact 後續跑 + 本地／trial 提早停機續跑 | `/auto-continue on\|off\|status\|reset` |
| **context-guard** | 雙水位線 Plan-aware compaction，長任務不爆 context | `/ctx-guard …` |
| **git-checkpoint** | 每輪 git stash 檢查點，`/fork` 可還原 | (event-driven) |
| **handoff** | 新 session 帶精煉 context，比硬 compact 乾淨 | `/handoff …` |
| **notify-ready** | agent 真正 settle 才通知（不跟 auto-continue 搶） | `/notify-ready …` |

Optional workspace template (copy manually):

- `templates/AGENTS.client.md` — deliverable write discipline（禁半篇覆蓋完整稿）

## Config (environment)

| Variable | Effect | Default |
|---|---|---|
| `CYUH_PI_KIT_PREMATURE_PROVIDERS` | auto-continue premature-stop allow-list | `omlx,YCBWIN_TRIAL` |
| `PI_AUTO_CONTINUE_PROVIDERS` | same (alias) | — |
| `CYUH_PI_KIT_CONTEXT_PROVIDERS` | context-guard provider list | omlx, ycbwin, YCBWIN_TRIAL, major clouds |

Example (Windows cmd before launching Pi):

```bat
set CYUH_PI_KIT_PREMATURE_PROVIDERS=omlx,YCBWIN_TRIAL,openai
```

## Dual-load warning

If the project still has copies under `.pi/extensions/` with the **same behavior** (e.g. old `local-auto-continue.ts`), Pi may register twice. Prefer:

1. Install this package only, **or**
2. Project copies only — not both.

```bash
node bin/cyuh-pi-kit.mjs doctor
```

## Not in this pack (internal only)

See `SCOPE.md`. Examples: herdr, protected-paths, sensitive-gate, pi-loop/Themis, delegate-ycbwin, productivity-tools with host paths.

## Verify

```bash
npm test
node bin/cyuh-pi-kit.mjs where
```

## Relationship to cyuh-pi-suite

| | **cyuh-pi-kit** | **cyuh-pi-suite** |
|---|---|---|
| Audience | external clients | Clotho / Lachesis / internal |
| Visibility | **public** | private |
| Goal | one pack, most workflows work | full internal automation |
| Paths | portable | may assume TVW layout |
| Install | safe default for clients | do not ship wholesale |

Roadmap: `docs/ROADMAP.md`.
