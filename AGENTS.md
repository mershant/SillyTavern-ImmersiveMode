# Immersive Mode

A SillyTavern extension that improves readability by preventing skimming. It
shows an assistant message one beat at a time on a focused reading surface, so
the eye cannot jump ahead or lose its place in a wall of text.

The reader never summarizes, rewrites, or shortens the message. Every word the
user would see in chat is still there; only the presentation changes. A change
that makes skimming easier again, or that drops or alters message content,
works against the product even if it looks like a feature.

Read `/home/opc/projects/st-extensions/AGENTS.md` before working here, and load
the global `sillytavern-extension` skill for any extension work. Domain
vocabulary lives in `CONTEXT.md`. User-facing behavior and settings are
described in `README.md`; keep that file current when behavior changes.

## Repository

- Canonical clone: `/home/opc/projects/st-extensions/immersive-mode`
- GitHub: `mershant/SillyTavern-ImmersiveMode` (public). SillyTavern installs it
  under the folder name `SillyTavern-ImmersiveMode`; the local clone uses a
  different name, so install-identity checks cover both.
- Plain JavaScript, no build step: `index.js`, `style.css`, `settings.html`,
  `manifest.json`. `src/install-path.js` (from the kit starter) works out the
  install folder at load time. Unit tests run with `npm test`.
- Push only when the user asks.

## Development environment

All live testing runs in the isolated STD host, never in main SillyTavern. The
extension kit at `/home/opc/projects/st-extensions/sillytavern-extension-kit`
owns the deterministic checker, the STD installer, and the no-model smoke test
(`tools/st-extension check` / `smoke-std`); its `okf/index.md` documents the
environment contract and which host is the active STD.

Main SillyTavern data folders already hold installed copies of this extension.
They are the user's installs, not development copies. Do not edit them.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
