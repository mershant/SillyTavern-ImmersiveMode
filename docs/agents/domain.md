# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If either location doesn't exist, proceed silently. The `/domain-modeling` skill creates domain documentation when terms or decisions are resolved.

## File structure

This is a single-context repo:

/
├── CONTEXT.md
├── docs/
│   ├── agents/
│   └── adr/
├── index.js
├── style.css
└── settings.html

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, either reconsider the invented language or note a real gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict rather than silently overriding it.
