# SCOPE — cyuh-pi-kit vs cyuh-pi-suite

## cyuh-pi-kit (this repo)

**Audience:** external client Pi seats (Windows / macOS / Linux).

**Contract:**

- Installable as one Pi package (`package.json` → `pi.extensions`).
- No hardcoded operator home paths (`/Users/cyuh/…`).
- No herdr / Themis durable loop / fleet SSH helpers.
- No secrets, auth tokens, or model API keys.
- Modules must degrade safely if optional env is missing.
- Prefer English UI strings for cross-locale clients; Traditional Chinese OK in docs.

**v0.1 included**

- auto-continue
- context-guard
- git-checkpoint
- handoff
- notify-ready
- templates/AGENTS.client.md (manual copy)

## cyuh-pi-suite (internal)

**Audience:** Clotho, Lachesis, TVW development.

**May include** path-bound or fleet-bound tools:

- herdr-agent-state / herdr-dispatch
- protected-paths / sensitive-gate / tool-output-guard
- pi-loop + Artifacts/pi-loop Themis engine
- delegate-ycbwin
- research-loop → TVW python gates
- productivity-tools with host-absolute paths
- local-auto-models bound to shared lab ports

**Do not** `pi install` the full suite onto a client as the default path.

## Promotion rule

A module moves suite → kit only when:

1. No host-absolute paths
2. No internal-only services required at import time
3. Config is env/settings based
4. Has a smoke test in `tests/`
5. Documented in README table + ROADMAP status = shipped
