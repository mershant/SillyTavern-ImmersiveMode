# SillyTavern Immersive Mode

**Immersive Mode** is a center-focal reading overlay for SillyTavern. It is built for long AI replies, roleplay narration, fiction-style chat, and any message where your eyes tend to skip, skim, or lose place in a wall of text.

Instead of forcing you to read a full chat bubble at once, Immersive Mode turns a message into readable **beats**: sentences, dialogue, actions, code blocks, regex-rendered cards, or larger balanced chunks depending on your settings. You move through the message with scroll, drag, keyboard, swipe, or auto-scroll.

The goal is simple:

> Make long AI messages easier to actually read.

Not summarize them. Not rewrite them. Not gamify them. Just present them in a focused, smooth, readable way.

---

## What problem does this solve?

SillyTavern messages can become dense quickly:

- long roleplay narration,
- multi-paragraph assistant replies,
- mixed dialogue + action,
- markdown/regex cards,
- code blocks,
- hidden metadata,
- character sheets,
- status trackers,
- huge single-message scenes.

Normal chat UI encourages skimming. Your eye jumps ahead, loses the sentence, or skips important details. Immersive Mode gives the message a dedicated reading surface:

- one focal beat at a time,
- optional previous/next context,
- smooth motion instead of hard jumps,
- large typography,
- adjustable speed/sensitivity,
- rendered regex/HTML support,
- mobile/performance controls,
- auto-scroll for hands-free reading.

It is meant to behave more like a premium reading mode / visual-novel-style focus viewer than a chat bubble.

---

## Core Features

### Center-focal reader

Immersive Mode opens a full-screen-ish overlay on top of SillyTavern and focuses the selected assistant message.

The text is displayed as floating typography over the existing SillyTavern background/theme. It does **not** default to chat bubbles, cards, or a generic frosted panel.

### Beat-based reading

Messages are split into readable beats. Depending on your settings, beats can be:

- sentences,
- larger balanced blocks,
- punctuation-based chunks,
- quoted dialogue,
- inline actions/emphasis,
- code cards,
- rendered HTML/regex cards.

The reader is designed around comprehension and pacing, not speed-reading gimmicks.

### Smooth scroll and drag

You can navigate by:

- mouse wheel,
- touchpad scroll,
- vertical pointer/touch drag,
- keyboard arrows,
- spacebar,
- mobile swipe,
- auto-scroll.

Direct pointer drag always acts as free-position drag, even if wheel behavior is set to swipe. This means dragging stays natural and continuous.

### Auto-scroll

Auto-scroll can be toggled inside Immersive Mode with the `▶ auto` button.

It can also be configured from the settings drawer.

Auto-scroll behavior:

- tap `▶ auto` to start/stop,
- press and drag the auto button left/right to adjust speed,
- manual scroll/drag **pauses** auto-scroll instead of turning it off,
- after manual input, auto-scroll resumes smoothly,
- speed ramps back in instead of snapping.

### Drag / wheel sensitivity

A bounded sensitivity slider controls drag/wheel feel:

- default/current feel: `1.00x`,
- lower bound: `0.65x`,
- upper bound: `1.25x`.

The range is intentionally limited so it can be slower or faster without becoming unusable.

### Multiple display modes

Current display modes:

- **Spotlight** — minimal focus, mostly active beat only.
- **Teleprompter** — flatter vertical reading flow with context.
- **Rotary** — 3D picker-like motion with previous/next context.

### Text positions

Choose where the focused text sits:

- Center,
- Top,
- Bottom.

### Glass text materials

The “glass” in this extension refers to the **text material**, not a generic frosted rectangle.

Available text materials:

- Pearl,
- Crystal,
- Etched,
- Liquid.

These affect typography glow, fill, depth, and feel.

### Context preview controls

You can show or hide previous/next context ghosts and control how many beats are visible:

- both directions,
- ahead only,
- behind only.

### Progress display

Optional progress rail and subtle counter show where you are in the message.

### In-mode controls

Small controls appear inside the overlay:

- `A−` smaller text,
- `A+` larger text,
- `▶ auto` auto-scroll toggle/speed control,
- progress rail/counter.

Controls can be hidden if you want a cleaner reading surface.

---

## Content and parsing features

### RP mode and General mode

Immersive Mode has two broad parsing modes.

#### RP mode

Designed for roleplay/fiction chat.

It tries to keep dialogue and narration readable without flattening everything into plain text.

#### General mode

Designed for non-RP assistant messages.

It avoids RP-specific assumptions and handles general prose more plainly.

### Extraction modes

#### Per sentence

Splits on sentence boundaries only.

Good default for prose and fiction.

#### Per punctuation

Splits longer text more aggressively at punctuation.

Useful when sentences are too long for comfortable centered reading.

#### Balanced blocks

Keeps larger chunks together.

Useful if you prefer fewer transitions and more paragraph-like reading.

### Big narration splitting

`Split big narration blocks` helps avoid giant centered walls of text.

### Italics behavior

By default:

```txt
*italic/action text* stays inline.
```

It renders as italics but does **not** become a separate beat.

If you want old behavior, enable:

```txt
Split *italic/action* text into its own beat
```

Default: **off**.

### Markdown/asterisk separators

Markdown separators like:

```txt
***
```

are hidden by default so they do not create awkward blank beats.

Optional setting:

```txt
Include *** separators as visible dividers
```

When enabled, they render as subtle decorative dividers.

### Bracket/pipe cleanup

Optional cleanup for bracket syntax like:

```txt
[a|b]
```

Useful for messages containing prompt/control syntax.

---

## Rendered SillyTavern output support

One of the most important features is that Immersive Mode can read the **rendered SillyTavern message DOM**, not just raw `message.mes`.

This matters because SillyTavern regex replacements often run only on display.

For example, raw message text may contain something like:

```txt
[NPC:MAJOR|Kieran Blackwood]
...
[/NPC]
```

But SillyTavern may render that as a styled `<details>` card in chat.

Immersive Mode can capture the rendered output instead, so the reader sees the transformed result instead of raw tag soup.

Setting:

```txt
Use SillyTavern's rendered output (honors regex & markdown)
```

Default: **on**.

---

## HTML / regex card support

Experimental special block handling can render HTML and regex output live.

### Render HTML / regex output live

Setting:

```txt
Render HTML / regex output live (colors, cards)
```

Default: **off**.

When enabled:

- inline `<font color="...">...</font>` is preserved,
- colored spans are preserved,
- regex-generated `<details>` cards can render as live cards,
- `<details>` cards are auto-expanded inside Immersive Mode,
- large cards are internally scrollable.

Example supported inline HTML:

```html
<font color="#8FAE7B">"You're not screaming."</font>
```

This remains colored inside Immersive Mode.

### Skip rendered details cards

If you do **not** want regex-generated cards in the reader, enable:

```txt
Skip rendered <details> cards instead of showing them
```

### Code blocks

Setting:

```txt
Render code blocks as code cards
```

Default: **off**.

When enabled, code blocks become fitted monospace cards rather than prose beats.

### Prevent stray HTML/code capture

Setting:

```txt
Prevent stray HTML/code from being captured
```

This helps avoid random HTML/code snippets polluting normal prose.

When a special block type is enabled, prevention is skipped for that type so the settings do not fight each other.

---

## Streaming behavior

Immersive Mode can update during assistant streaming.

Setting:

```txt
Capture streaming assistant responses
```

Important behavior:

- Streaming capture does **not** open Immersive Mode by itself unless auto-open is enabled.
- If you close Immersive Mode while a message is still streaming, it stays closed for that same streaming message.
- Streaming updates are batched for performance.

Batching:

- normal: about `180ms`,
- mobile/performance mode: about `360ms`.

This reduces mobile lag by avoiding rebuild/re-measure work on every token.

---

## Auto-open behavior

Setting:

```txt
Auto-open for new assistant messages
```

When enabled, new assistant messages can open automatically.

If you manually close Immersive Mode while the message is still streaming, it will not immediately reopen for that same message.

---

## Hidden message support

SillyTavern hidden messages can be marked internally as system-like messages. Immersive Mode allows explicitly opened hidden messages to be read.

This is useful if you hide a message from the AI context but still want to view it in the immersive reader.

---

## Mobile and performance mode

Mobile reading is supported with viewport-safe sizing and touch controls.

Settings:

```txt
Mobile Performance Mode
```

Options:

- Auto,
- Always on,
- Always off.

Auto mode detects touch phones/tablets and avoids treating portrait desktop monitors as mobile.

Performance mode reduces expensive effects like glow/blur/3D perspective for smoother scrolling.

---

## Overflow handling

Long beats should not break the viewport.

Immersive Mode uses a two-step fallback:

1. shrink oversized prose beats to fit,
2. if still too large, make that beat internally scrollable.

Setting:

```txt
Shrink oversized prose beats to fit screen
```

---

## Controls

### Keyboard

- `ArrowRight` / `ArrowDown` / `Space`: next beat
- `ArrowLeft` / `ArrowUp`: previous beat
- `Escape`: close Immersive Mode

### Mouse / touch

- scroll wheel / touchpad scroll,
- pointer/touch drag,
- mobile left/right swipe if enabled.

### In-overlay controls

- `A−`: smaller text
- `A+`: larger text
- `▶ auto`: auto-scroll toggle
- press/drag `▶ auto` left/right: set auto-scroll speed
- `✕`: close
- `⤢`: hide/show SillyTavern chrome

---

## Settings overview

### Content & Parsing

- Content Mode
- Extraction Mode
- Split big narration blocks
- Use SillyTavern rendered output
- Skip rendered `<details>` cards
- Prevent stray HTML/code capture
- Ignore bracket choices like `[a|b]`
- Include `***` separators as visible dividers
- Split `*italic/action*` text into its own beat
- Render code blocks as code cards
- Render HTML / regex output live

### Display

- Display Mode
- Text Position
- Glass Text Material
- Font Size
- Line Spread
- Show previous/next context ghosts
- Shrink oversized prose beats to fit screen
- Show progress rail
- Show subtle message IDs
- Show in-mode reading controls
- Context preview counts

### Scrolling & Motion

- Scroll Mode
- Scroll Behavior
- Scroll Feel
- Scroll Weight
- Threshold
- Drag / wheel sensitivity
- Auto-scroll enable
- Auto-scroll speed

### Behavior & Exit

- Auto-open for new assistant messages
- Capture streaming assistant responses
- Fade back to chat at the end
- Exit when pushing past the end
- Exit when pushing before the start
- Hide top bar/chat bar while open
- Mobile left/right swipe navigation
- Show immersive button on messages
- Show immersive button beside Send

### Mobile / Performance

- Auto / Always on / Always off
- Current performance status display

---

## Installation

Install as a third-party SillyTavern extension from:

```txt
https://github.com/mershant/SillyTavern-ImmersiveMode
```

In SillyTavern:

1. Open **Extensions**.
2. Open **Install extension** / third-party extension installer.
3. Paste the GitHub URL.
4. Install and reload SillyTavern.
5. Open the Immersive Mode settings drawer.

---

## Development / local path

David's local development install path:

```txt
C:\Users\mershant\Projects\SillyTavern\data\default-user\extensions\SillyTavern-ImmersiveMode
```

Standalone GitHub repo path:

```txt
C:\Users\mershant\Projects\SillyTavern-ImmersiveMode
```

SillyTavern serves the extension at:

```txt
/scripts/extensions/third-party/SillyTavern-ImmersiveMode/
```

---

## Verification checklist for contributors

Before claiming a change works:

```bash
npm run lint
```

Then verify in a real SillyTavern browser session:

- extension loads,
- console has no extension JS errors,
- opening latest message works,
- direct message button works,
- scroll/drag behavior works,
- keyboard navigation works,
- auto-scroll works,
- streaming does not auto-open incorrectly,
- rendered regex/HTML works if modified,
- mobile/performance behavior still works.

Useful regression fixtures:

### Inline font

```html
Before <font color="#8FAE7B">green words</font> after.
Next sentence.
```

Expected:

- no blank beat,
- `green words` remains colored if HTML rendering is enabled,
- no weird front/back spacing.

### Empty font

```html
<font color="#8FAE7B">   </font>Real sentence.
```

Expected:

```txt
Real sentence.
```

### Inline italics

```txt
A sentence with *landing* inside it.
```

Expected by default:

```txt
A sentence with landing inside it.
```

Rendered HTML includes:

```html
<em>landing</em>
```

### Asterisk separator

```txt
First line.
***
Second line.
```

Expected by default:

```txt
First line.
Second line.
```

---

## Design principles

Immersive Mode is built around these principles:

1. **Readability first.** Effects should help reading, not distract from it.
2. **Centered focus.** The current beat should be easy to lock onto.
3. **Smooth motion.** Scrolling and dragging should feel continuous and premium.
4. **Respect SillyTavern rendering.** If ST regex/markdown changes what the user sees, Immersive Mode should be able to read that rendered output too.
5. **Do not surprise the user.** Streaming capture should not open the overlay unless auto-open is enabled; closing should stay closed.
6. **Mobile matters.** Performance and touch behavior must stay usable.

---

## Current status

The extension is actively evolving. It currently focuses on the beat-based Immersive Mode reader. Experimental Reveal-mode concepts are being explored separately and are not part of the production extension yet.
