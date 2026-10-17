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

Direct pointer drag always acts as free-position drag, whatever the wheel setting. This means dragging stays natural and continuous.

The wheel and keys have three modes (**Motion → Wheel and keys**):

- **Free scroll** (default) — glide and rest anywhere.
- **Snap to the nearest line** — glide, then settle onto a line. The **Snap point** slider sets how far toward the next line you must scroll before it snaps forward instead of back.
- **One line per notch** — each wheel notch or key press moves exactly one line.

Quick key presses queue up: pressing ↓ three times fast moves three lines.

### Edge bounce and exit

At the first and last line the reader bounces softly and that screen edge lights up (see **Background and edges**). Closing works as before: reaching the edge stops you there (now with a bounce), and the next push past it closes. That next push counts even while the bounce is still settling. Either exit can be turned off.

### Auto-scroll

Auto-scroll can be toggled inside Immersive Mode with the `▶ auto` button.

It can also be configured from the settings drawer.

Auto-scroll behavior:

- tap `▶ auto` to start/stop,
- press and drag the auto button left/right to adjust speed,
- manual scroll/drag **pauses** auto-scroll instead of turning it off,
- after manual input, auto-scroll resumes smoothly,
- speed ramps back in instead of snapping,
- with **Fade back to chat when auto-scroll finishes** on, the reader waits about 1.5 seconds on the last line and then fades back to chat. Reading by hand never closes on its own.

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

These affect typography glow, fill, depth, and feel. Etched is the sharpest and the default.

### Focus feedback

- **Focus bloom** — the center line warms up as it reaches the center and cools as it leaves. It follows the motion, so a fast swipe gives a smooth shimmer, not separate flashes.
- **Settle glow** — when scrolling stops, the line you landed on glows once, slowly.

### Background and edges

- **Background** — **Frosted glass** (default) blurs SillyTavern's page behind the reader, with a fine grain, like a frosted window over the chat. It works with SillyTavern's Fast UI mode on. **Dim only** just darkens the page. Performance mode always uses Dim only, since blurring the whole page is the most expensive effect.
- **Edge at first and last line** — what lights up when you push past the first or last line. **Glass rim** (default) is a strip of glass along that screen edge that catches the light. **Soft glow** is a wide, soft pool of light with no line. Only the edge you pushed against lights up.

### Ambient progress

Two quiet effects show how far you are without adding anything to read:

- **Edge trace** — a thin line of light starts at the top center and traces down both sides of the screen, meeting at the bottom when you reach the last line.
- **Dawn** — a faint glow sinks from the top of the screen to the bottom and slowly warms from blue to amber as you read.

Both drift behind your position on a soft spring rather than jumping, and both sit behind the text.

More quiet touches, each with its own switch:

- **Light sweep** — when you land on a line, one soft band of light crosses it once. It does not repeat while you stay on that line.
- **Ink settle** — the arriving line sharpens from a hair of blur. Skipped while you fling past lines.
- **Breathing** — after you rest on a line for a couple of seconds, its glow rises and falls very slowly until you move.
- **Dialogue warmth** — the center warms slightly while the focused line is speech.
- **Finish ring** — resting on the last line makes the edge trace glow once.
- **Depth sway** — the background leans with your scroll and settles back, so the text seems to float above it.
- **Trailing lines** — the lines before and after follow the focused line a beat late.
- **Focus vignette** — the screen edges darken a little while you scroll fast, then relax.

The **Balanced** preset (the default) turns on all of these except Dawn, Focus vignette and Dialogue warmth; see **Effects presets and cost**. Performance mode skips ink settle and trailing lines and drops the glows.

### Message colors

Messages often carry their own colors: the model writes `<font color>` or styled spans, or a preset's regex adds colored classes. The reader keeps those colors, including regex classes, because it reads the colors from the chat as shown.

The reader draws on a dark surface, so a color picked for a light theme could vanish. Each color keeps its hue but is lightened until it is readable (at least 4.5:1 contrast). A colored passage that spans several lines stays colored on every line. Turn this off with **Keep message colors**.

### Context preview controls

You can show or hide previous/next context ghosts and control how many beats are visible:

- both directions,
- ahead only,
- behind only.

### Progress display

Optional progress rail and subtle counter show where you are in the message. Rail styles:

- **Osmosis** — the lit dot is a drop of liquid that flows from dot to dot and stretches with speed.
- **Liquid line** (default) — a filled line with a drop at its head that lags slightly and wobbles when you stop.
- **Glass capsule** — a small glass lens slides along the rail and stretches when it moves fast.
- **Ticks** — one dot per line, the current one lit.
- **Plain line** — a thin filled line.

Long messages share dots (up to 24), so the rail stays readable.

### In-mode controls

Small controls appear inside the overlay:

- `A−` smaller text,
- `A+` larger text,
- `▶ auto` auto-scroll toggle/speed control,
- progress rail/counter.

Controls can be hidden if you want a cleaner reading surface. **Liquid glass buttons** gives them a glass look that squishes when pressed.

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

HTML and regex output is shown as live cards inside the reader, so you never have to leave it to see a status panel, tracker, or styled block.

Setting:

```txt
Show HTML and regex output as live cards
```

Default: **on**.

- regex-built blocks (`<details>`, tables, styled `<div>` cards, `<figure>`, `<blockquote>`) render live,
- `<details>` cards open automatically,
- the message's own `<style>` rules apply to its cards, the same way they apply in chat,
- a card taller than the screen scrolls inside itself first: wheel, drag, or ↓ scrolls the card, and the reader moves on once the card's end is reached,
- cards always stay between the top buttons and the bottom controls, whatever the text position.

Message colors are kept whether or not cards are on (see **Message colors**).

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

## Performance

The reader only rebuilds a line's text when that line first comes into view; while you scroll it just moves what is already there. Line heights are remembered, so a streaming reply only measures the lines that changed. Effects only redraw when their value visibly changes, and every animation loop stops when the reader is still. For what each effect costs, see **Effects presets and cost**.

**Performance → Performance mode** (Auto / Always on / Always off) drops glow, blur, 3D tilt, and glass effects for smoother scrolling on slower devices. The liquid rails and glass buttons switch to simple versions. Auto turns it on for touch phones and tablets and leaves portrait desktop monitors alone.

---

### Effects presets and cost

**Look & Feel → Effects preset** sets every visual effect at once:

| Preset | What it keeps | Measured cost |
|---|---|---|
| **Balanced** (recommended, default) | Everything except Dawn, Focus vignette and Dialogue warmth; Liquid line rail | +23% |
| Light | Only the near-free effects: settle glow, sweep, ink settle, breathing, sway, trailing lines, glass, frosted background | +6% |
| Full | Every effect | about +120% |
| Minimal | Nothing but the edge bounce and a plain progress line | 0% |

Every effect in the drawer shows its own cost tag, and a meter shows the total for your current mix. Changing any effect switches the preset to **Custom**; the meter then shows an estimate (marked `~`).

Cost means how much longer each animation frame takes while scrolling, compared with every effect off. It was measured with `scripts/measure-effects.mjs` on a slow test server with no graphics card, where the browser draws everything in software. A normal PC or phone is much faster, so the numbers are for comparing effects, not a promise of frame rate. The most expensive single choices are the Liquid text material (+44%), Dawn (+18%), Focus vignette (+17%), Edge trace (+16%) and the Crystal text material (+16%). The numbers live in `src/effects.js`; re-run the script after changing an effect.

## Fitting long lines and cards

Nothing is cut off, whatever the text position (Top, Center, or Bottom):

1. the focal line or card always stays between the top buttons and the bottom controls; near an edge the whole stack slides to keep it there,
2. oversized prose lines shrink to fit (**Shrink oversized lines to fit the screen**),
3. anything still too tall, such as a long card or code block, scrolls inside itself before the reader moves on.

---

## Controls

### Keyboard

- `ArrowDown` / `ArrowRight` / `Space` / `PageDown`: next line (or scroll inside a tall card)
- `ArrowUp` / `ArrowLeft` / `PageUp`: previous line
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

The drawer has six sections, most used first.

### Reading

- Display mode, Text position
- Font size, Line spread
- Show context lines before and after; Lines ahead, Lines behind
- Shrink oversized lines to fit the screen

### Look & Feel

- Effects preset (Balanced / Light / Full / Minimal / Custom) with a cost meter
- Text material, Background, Edge at first and last line, Progress rail style
- Lines: Keep message colors, Focus bloom, Settle glow, Light sweep, Ink settle, Breathing, Dialogue warmth
- Ambient: Edge trace, Dawn, Finish ring, Depth sway, Trailing lines, Focus vignette
- Interface: Liquid glass buttons, Show progress rail, Show reading controls, Show message IDs

### Motion

- Wheel and keys: Free scroll / Snap to the nearest line / One line per notch
- Snap point (shown for Snap only)
- Scroll feel, Scroll weight, Drag / wheel sensitivity
- Edge bounce
- Auto-scroll on open, Speed, Fade back to chat when auto-scroll finishes

### Opening & Closing

- Open automatically for new replies, Follow replies while they stream
- Close when pushing past the last line / before the first line
- Hide SillyTavern's top bar and chat bar while reading
- Swipe left or right to change lines (phones)
- Reader button on messages / beside Send

### Text Splitting & Cards

- Content mode, Split by
- Cards: HTML and regex output, code blocks, skip `<details>`
- Cleanup: read what the chat shows, split big narration, italic actions on their own line, `***` dividers, hide `[a|b]` choices, hide stray HTML/code

### Performance

- Performance mode: Auto / Always on / Always off, with current status

Settings saved by older versions carry over. The old Scroll Mode and Scroll Behavior pair becomes one **Wheel and keys** setting: either one set to step/swipe becomes **One line per notch**, anything else **Free scroll**.

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

## Development

The extension is plain JavaScript with no build step. SillyTavern serves it from its install folder, for example:

```txt
/scripts/extensions/third-party/SillyTavern-ImmersiveMode/
```

The code works out its own folder name at load time, so it keeps working if the folder is renamed.

---

## Verification checklist for contributors

Before claiming a change works:

```bash
npm test
node scripts/live-acceptance.mjs   # after installing into the isolated test SillyTavern
```

`scripts/live-acceptance.mjs` drives the reader in a real browser at desktop and phone sizes (colors, scrolling, edge bounce and exit, cards, fitting, the drawer) and never sends a message to a model. Also check by hand:

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
- `green words` stays colored (lightened if needed so it is readable),
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
