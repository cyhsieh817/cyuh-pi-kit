# ROADMAP — cyuh-pi-kit

Goal: **one pack** clients install so most Pi agent jobs finish without operator babysitting.

## Shipped (0.1.0)

- [x] Package skeleton + private repo layout
- [x] auto-continue (compact + premature-stop; env provider list)
- [x] context-guard (Plan-aware dual waterline; env provider list + YCBWIN_TRIAL)
- [x] git-checkpoint
- [x] handoff
- [x] notify-ready
- [x] AGENTS.client.md deliverable template
- [x] doctor dual-load check

## Next (0.2)

- [ ] Windows-first install notes + scp fallback when `pi install` git auth blocked
- [ ] Optional deliverable-guard extension (block short overwrite of long files)
- [ ] plan-mode (sanitized; no TVW paths)
- [ ] cache-ttl footer (if useful on client cloud providers)
- [ ] `cyuh-pi-kit doctor --client` checks: extensions loaded, provider id visible, `/auto-continue status` contract

## Later (0.3+)

- [ ] Subagent pack (only if peer deps stable across Pi versions)
- [ ] Permission-gate lite (generic confirm; no TVW policy files)
- [ ] One-command wire script used by client-assist P4 (install kit + seed AGENTS.md)
- [ ] Version pin matrix vs Pi coding-agent releases

## Explicit non-goals

- Shipping herdr / Themis / protected-paths to clients
- Embedding company model credentials
- Replacing channel/tunnel onboarding (that stays client-assist P0–P3)
