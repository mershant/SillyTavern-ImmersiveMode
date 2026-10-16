# Immersive Mode — Context

## Purpose

Long AI replies invite skimming: the eye jumps ahead, loses the sentence, and
misses details. Immersive Mode removes that by giving one message its own
reading surface and moving through it one beat at a time. Readability means the
reader actually reads every part, in order, without losing place.

## Glossary

- **Beat** — one unit of the message shown in focus at a time: a sentence, a
  punctuation chunk, a balanced block, a code card, or a rendered HTML/regex
  card, depending on the extraction mode.
- **Focal beat** — the beat currently in focus. Everything else on screen
  exists to support reading it.
- **Context ghosts** — dimmed previous/next beats around the focal beat. They
  keep the reader oriented without inviting them to read ahead.
- **Extraction mode** — how a message is split into beats: per sentence, per
  punctuation, or balanced blocks.
- **Content mode** — RP mode (dialogue, narration, actions) or General mode
  (plain assistant prose).
- **Display mode** — how beats are laid out: Spotlight, Teleprompter, Rotary.
- **Text material** — the look of the text itself (Pearl, Crystal, Etched,
  Liquid). Not a panel or card behind the text.
- **Rendered output** — the message as SillyTavern shows it in chat, after
  regex and markdown. Preferred over the raw message text so the reader sees
  what the user would see.
- **Special block** — code blocks and rendered HTML/regex cards (such as
  `<details>` cards), which can be shown as cards, skipped, or kept out of
  prose beats.
- **Barrier** — the stop at the start or end of a message. Once the reader is
  parked there, pushing further in the same direction exits back to chat.

## Avoid

- "Summary", "condensed", "speed reading": the product never shortens or
  speeds past content.
- "Frosted panel" or "glass card" for text material: the glass is the text.
