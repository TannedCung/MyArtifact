# Handoff: MyArtifact Studio redesign ("Moss")

## Overview
This is a redesign of the MyArtifact web studio (`src/web/` in `TannedCung/MyArtifact`). It changes the current dark slate/indigo UI to a warm, paper-toned design system called **Moss**, with day and night themes. It also simplifies the layout and adds these UX improvements:
- a version history dropdown with a read-only banner for historical versions
- a ⌘K command palette and keyboard shortcuts
- a code editor with line numbers and an explicit save state
- a diff view with line numbers and collapsed unchanged lines
- a key/value table for state
- delete confirmation that requires typing the slug
- toasts
- templates and themes in the New artifact dialog

It also includes an **agent kit** (themes, templates and an extended `SKILL.md`) for assistants that create artifacts.

## About the design files
The files in `designs/` are **design references built in HTML**. They are prototypes that show the intended look and behaviour; they are not production code. Recreate them in the existing stack: **React 19 + Tailwind v4 + lucide-react**, built with Vite, in `src/web/App.tsx` and `src/web/components/*`. Keep all existing data flow (REST, WebSocket live reload, `SandboxRenderer`, `DiffViewer` with `diff`). Only the presentation and interaction layer changes.

To view a design, serve the `designs/` folder (for example `npx serve designs`) and open the `.dc.html` files. They need `support.js` next to them.

## Fidelity
**High fidelity.** Colours, type, spacing, radii and interactions are final. Recreate them pixel-accurately with Tailwind utilities and the tokens below.

---

## Design tokens

Add these to `src/web/styles.css` as Tailwind v4 theme variables. Night values override day values when `<html data-theme="night">` is set.

```css
@import "tailwindcss";

@theme {
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --color-canvas: var(--c-canvas);        /* app background, sidebar */
  --color-raised: var(--c-raised);        /* main pane, cards, popovers */
  --color-sunken: var(--c-sunken);        /* hover fills, chips, segmented bg */
  --color-line: var(--c-line);            /* default 1px borders */
  --color-line-strong: var(--c-line-strong); /* input/button borders */
  --color-ink: var(--c-ink);
  --color-ink-2: var(--c-ink-2);          /* secondary text */
  --color-ink-3: var(--c-ink-3);          /* muted text, 4.7:1 */
  --color-ink-4: var(--c-ink-4);          /* gutters, placeholders' icons */
  --color-sage: var(--c-sage);            /* primary action bg, selection rule */
  --color-sage-hover: var(--c-sage-hover);
  --color-sage-soft: var(--c-sage-soft);  /* selected row, active chip */
  --color-sage-focus: #8FA28A;            /* focus ring */
  --color-brass: #C8A96B;                 /* versions, history */
  --color-brass-soft: var(--c-brass-soft);
  --color-brass-line: var(--c-brass-line);
  --color-brass-ink: var(--c-brass-ink);
  --color-add: var(--c-add);   --color-add-ink: var(--c-add-ink);
  --color-del: var(--c-del);   --color-del-ink: var(--c-del-ink);
  --color-danger: var(--c-danger); --color-danger-soft: var(--c-danger-soft); --color-danger-ink: var(--c-danger-ink);
}

:root {
  color-scheme: light;
  --c-canvas:#F7F4ED; --c-raised:#FCFBF7; --c-sunken:#EFEBE1; --c-line:#E2DDD0; --c-line-strong:#D3CDBD;
  --c-ink:#1E2420; --c-ink-2:#4A524A; --c-ink-3:#656C62; --c-ink-4:#9A9F94;
  --c-sage:#55684F; --c-sage-hover:#435340; --c-sage-soft:#E4EADF;
  --c-brass-soft:#F8F1E3; --c-brass-line:#EADBB8; --c-brass-ink:#735C2B;
  --c-add:#EEF2EA; --c-add-ink:#2F3B2C; --c-del:#F8ECE7; --c-del-ink:#6E2E20;
  --c-danger:#B4553F; --c-danger-soft:#F4E2DB; --c-danger-ink:#8A3A28;
}
:root[data-theme="night"] {
  color-scheme: dark;
  --c-canvas:#151A16; --c-raised:#1D231E; --c-sunken:#262D27; --c-line:#2D352E; --c-line-strong:#3A443B;
  --c-ink:#ECEAE3; --c-ink-2:#B5BCB0; --c-ink-3:#9AA196; --c-ink-4:#7D8579;
  --c-sage:#8FA28A; --c-sage-hover:#A9BAA4; --c-sage-soft:#2A352B;
  --c-brass-soft:#2E2A1E; --c-brass-line:#4A4128; --c-brass-ink:#D9BE86;
  --c-add:#1F2A20; --c-add-ink:#C7D3C0; --c-del:#2E201C; --c-del-ink:#E7B3A5;
  --c-danger:#D98068; --c-danger-soft:#3A2520; --c-danger-ink:#E79A86;
}
```
Text on `sage` uses `canvas` as its colour (Paper in day, near-black in night). That gives 6.1:1 or better in both themes.

**Agent colours.** Each agent gets a dot and a tinted chip: background / text / dot.

| Agent | Day | Night |
| :-- | :-- | :-- |
| claude-code | `#F8F1E3` / `#735C2B` / `#C8A96B` | `#2E2A1E` / `#D9BE86` / `#C8A96B` |
| codex | `#EEF2EA` / `#3D4F39` / `#8FA28A` | `#1F2A20` / `#A9C2A2` / `#8FA28A` |
| antigravity | `#E1E8EE` / `#3E5266` / `#7C93A8` | `#1F2830` / `#A9BDD0` / `#93A9BD` |
| watcher | `#F4E7DF` / `#7A4A35` / `#B8876F` | `#33261F` / `#DDB09A` / `#C99A82` |
| user ("You") | `#EFEBE1` / `#4A524A` / `#9A9F94` | `#262D27` / `#B5BCB0` / `#7D8579` |

**Typography** (IBM Plex Sans / Mono, weights 400, 500 and 600; load from Google Fonts in `index.html`):
- Artifact title: 17px/26px, weight 600, tracking −0.01em
- UI body: 13px/18–20px, weight 400. Use weight 500 for selected tabs and buttons.
- Secondary text: 12px
- Eyebrow labels: Mono, 11px, uppercase, tracking 0.06–0.08em
- Code: Mono, 13px/20px. Diff code: Mono, 12.5px/20px.

**Spacing:** a 4px grid (4, 8, 12, 16, 20, 24, 32, 48).

**Radii:** 6px for controls, 8px for list rows and popover items, 10px for cards, popovers and toasts, 14px for dialogs, 999px for pills.

**Shadows:**
- e1: `0 1px 2px rgba(30,36,32,.06)`
- e2 (popovers): `0 6px 16px rgba(30,36,32,.10)`
- e3 (dialogs): `0 20px 48px rgba(30,36,32,.18)`

**Focus:** `border-color: #8FA28A; box-shadow: 0 0 0 3px rgba(143,162,138,.28)`.

**Scrollbar:** 8px wide, thumb `line-strong`, fully rounded, with a 2px transparent border.

**Selection:** `::selection { background: #C7D3C0 }`.

---

## Screens / views

Reference: `designs/MyArtifact Studio v2.dc.html`.

### Shell
The shell is `flex h-screen`, with a sidebar (272px, `bg-canvas`, right border `line`) and a main pane (`flex-1`, `bg-raised`).

### Sidebar
1. **Brand row**
   - 56px high, padding `0 12px 0 16px`, bottom border.
   - Logo tile: 28×28px, radius 7, `bg-sage`, Lucide `Layers` icon at 16px in `canvas`.
   - Next to the tile: "MyArtifact" at 14px/600. Below it, a status line at 11px in `add-ink`: a 6px dot `#6F8A69` with a 2px `sage-soft` ring, then "Live · :4173". This is driven by the WebSocket connection; when disconnected, show "Offline" with a dot in `ink-4`.
   - Right side, gap 4:
     - Theme toggle: 28×28px ghost button with a `Moon` icon (day) or `Sun` icon (night).
     - **New** button: 28px high, padding `0 10px`, `bg-sage`, text `canvas`, 12px/500, with a `Plus` icon at 14px.
2. **Search trigger**
   - Padding `12px 12px 8px`.
   - 32px high, radius 6, `bg-raised`, 1px `line-strong` border (`sage-focus` on hover).
   - Contents: `Search` icon at 14px in `ink-3`, then "Search or jump to…" in `ink-3`, then a `⌘K` kbd (Mono 11px, `bg-sunken`, 1px `line` border with a 2px bottom border, radius 4, padding `0 5px`).
   - Opens the palette.
3. **List**
   - Padding `4px 8px 12px`.
   - Each row is a button: grid `28px 1fr auto`, gap 10, padding `8px 10px`, radius 8.
   - Contents:
     - Type tile: 28×28px, radius 6, `bg-sunken`, type icon at 15px in `ink-2`.
     - Title: 13px/500, ellipsis.
     - Meta line: 12px in `ink-2`, a 6px agent dot, then "{Agent} · {relative time}".
     - Version pill: Mono 11px, padding `1px 6px`, radius 4. When the version is greater than 1, use `brass-soft` background and `brass-ink` text; otherwise transparent with `ink-3` text.
   - Selected row: `bg-sage-soft` plus `box-shadow: inset 2px 0 0 var(--color-sage)`. The tile becomes `bg-raised` with a 1px `#C7D3C0` border and the icon turns `sage`.
   - Hover: `bg-sunken`.
   - Sort by `updatedAt` descending.
   - Type icons: react → `Atom`, html → `CodeXml`, mermaid → `Workflow`, markdown → `FileText`, svg → `PenTool`, code → `FileCode`.

### Main header
- Padding `10px 20px 0`, bottom border.
- **Row 1** (`items-center justify-between`):
  - Left: title (17px/600, ellipsis), then the agent (7px dot plus 12px `ink-2` label, nowrap).
  - Right, gap 6:
    - **Version button:** 32px high, padding `0 10px`, 1px `line-strong` border, radius 6, 13px/500, nowrap. Contents: `History` icon at 14px in `#8E733D`, then "v{n}" and, in `ink-3`, "of {total}", then `ChevronDown` at 12px. Background is `brass-soft` while a historical version is shown.
    - **Export:** primary button with a `Download` icon.
    - **More:** 32×32px ghost button with an `Ellipsis` icon.
- **Version popover:**
  - 320px wide, max height 420px, positioned top 38px / right 0, padding 6, e2 shadow.
  - Each row: grid `16px 1fr`.
    - Node: 10px circle. The latest and viewed versions are filled `brass`; others are `raised` with a 2px `line-strong` border.
    - Text: "v{n}" at 13px/600, plus a tag "LATEST" or "VIEWING" (Mono 10px, uppercase, `brass-ink`). Below it, the summary at 13px `ink-2`, then "{Agent} · {time}" at 12px `ink-3`.
    - The viewed row has a `brass-soft` background.
  - Clicking a row selects that version and closes the popover.
- **More menu:** 220px wide. Items are 32px high with 14px icons:
  - Copy source (`Copy`)
  - Copy CLI command (`Terminal`), which copies `myartifact get {slug}`
  - a divider
  - **Delete…** (`Trash2`), in `danger-ink` with a `danger-soft` hover
- **Row 2:**
  - Tabs, gap 20: each is 36px high, 13px, with a 2px bottom border that is `sage` when active. Active tabs are `ink` at weight 500; inactive tabs are `ink-2` at 400.
  - Badges: Mono 11px, `bg-sunken`, padding `0 5px`, radius 4.
    - Code: a brass "●" when there are unsaved edits.
    - Changes: the number of versions, shown when there is more than one.
    - State: the key count, shown when there is at least one.
  - Right side, depending on the active tab:
    - Preview: a viewport segmented control. Background `sunken`, padding 2, radius 8. Items are 30×24px; the active one is `raised` with an e1 shadow. Options: `Monitor` = 100%, `Tablet` = 820px, `Smartphone` = 390px.
    - Changes: a "Collapse unchanged" checkbox, using `accent-color: sage`.

### Historical banner
Shown when the viewed version is not the latest.
- Padding `8px 20px`, `bg-brass-soft`, bottom border `brass-line`, 13px.
- Contents:
  - `History` icon in `#8E733D`.
  - The text "Viewing **v{n}** of {total} · read-only. Restoring creates v{total+1}; nothing is overwritten."
  - **Restore v{n}:** 28px high, `bg-brass`, text `#2A2110`, 12px/600, with a `RotateCcw` icon. Calls `POST /rollback`.
  - **Back to latest:** outline button with a `brass-line` border and `brass-ink` text.

### Preview tab
- Stage: padding 24, `bg-sunken` with a dot grid (`radial-gradient(var(--color-line-strong) 1px, transparent 1px) 0 0/16px 16px`). Use `overflow-x: hidden`.
- Frame:
  - Centred, `max-width` set by the viewport control, with a `max-width .25s ease` transition.
  - Radius 10, 1px `line-strong` border, e2 shadow.
  - Top bar: 30px high, `bg-raised`, Mono 11px in `ink-3`. Left: `ShieldCheck` icon at 12px in `#6F8A69`, then "sandbox · {slug}@v{n}" (ellipsis). Right: "Fill width", "820 px" or "390 px".
  - Below the bar, the existing `SandboxRenderer` iframe, min height 520px.

### Code tab
- **Path bar:** 34px high, `bg-canvas`, Mono 12px. Contents: `FileCode` icon in `sage`, then the file path (ellipsis), then "{lines} lines · {lang}" (nowrap).
- **Editor:**
  - A sticky gutter of line numbers: Mono 13px/20px, `ink-4`, right-aligned, padding `16px 12px 16px 20px`.
  - Then a textarea: Mono 13px/20px, no border, `white-space: pre`, auto height (`rows` = line count).
  - The editor is read-only when viewing a historical version.
- **Commit bar:**
  - Padding `10px 20px`, `bg-canvas`, top border.
  - Contents:
    - Status: a 7px dot plus 12px text. The text is "Unsaved changes" (brass dot, `brass-ink` text), "No changes since v{n}" (sage dot) or "Read-only · v{n}".
    - Summary input: 32px high, placeholder "Describe this version (optional)".
    - **Discard:** ghost button.
    - **Save as v{n+1}:** primary button with a `⌘S` kbd.
  - The buttons are disabled at 40% opacity when nothing has changed.

### Changes tab
- **Toolbar** (`bg-canvas`):
  - Two version selects, 30px high, labelled "v{n} · {Agent}", with an `ArrowRight` icon between them.
  - On the right: "+N" chip (`add` background, `add-ink` text) and "−N" chip (`danger-soft` background, `danger-ink` text).
  - **Restore v{from}:** brass-soft button, shown when `from` is not the latest.
- **Body:**
  - A container with radius 10 and a 1px `line` border. Header row: `bg-canvas`, showing the file name.
  - Rows: grid `44px 44px 20px 1fr` for old line number, new line number, sign and text.
    - Added: `add` background, `add-ink` text, sage "+".
    - Removed: `del` background, `del-ink` text, danger "−".
    - Context: `ink-2` text.
  - With "Collapse unchanged" on, keep 3 lines of context around each change and replace the rest with a `bg-canvas` row reading "⋯ N unchanged lines".
  - When both versions are the same, show the empty state "Pick two different versions".

### State tab
- Max width 880px, centred, padding 24.
- **Heading:** "window.storage" at 14px/600, with a one-line description. On the right: "{bytes} of 20 MB" (Mono 12px).
- **Table:** grid `200px 1fr 80px 40px` for key, value, size and delete.
  - Key: Mono 12.5px/500 in `sage-hover`.
  - Value: pretty-printed JSON in a `bg-canvas` box (radius 6, max height 180px, scrolls).
  - Size: Mono 12px, right-aligned.
  - Delete: ghost `Trash2` button with a `danger-soft` hover.
- **Last row** (`bg-canvas`): key input, value input and a **Set key** button. The button is at 40% opacity until a key is entered.
- **Empty state:** "No keys yet. The artifact writes here when it calls `window.storage.set`, or add one below."

### Empty main (no artifact)
Centred, max width 380px:
- 44×44px `sage-soft` tile with a `Layers` icon.
- "No artifact open" at 16px/600.
- A line about assistants and the `~/.myartifact/dropzone` folder.
- **New artifact** primary button.

### Command palette (⌘K)
- Overlay `rgba(30,36,32,.32)`. Panel width `min(560px, 92vw)`, top 14vh, radius 14, e3 shadow.
- Input row: 48px high, `Search` icon, 15px input, and an `esc` kbd.
- Two groups with Mono 11px uppercase headers:
  - **Artifacts:** matches on title, slug and tags. Meta reads "v{n} · {Agent}".
  - **Actions:** New artifact (N), Switch to night/day theme, Browse templates & themes, Toggle view shortcuts, Export current as HTML.
- Rows are 38px high, radius 8. The highlighted row is `sage-soft`.
- ↑/↓ move the highlight, ↵ runs it, esc closes.
- Footer hint: "↑↓ navigate · ↵ open · 1–4 switch view".

### New artifact dialog
- Width `min(640px, 100%)`, radius 14.
- Header: "New artifact" at 16px/600, with "Saved to ~/.myartifact as v1." below it.
- **Fields:**
  1. **Title.** Below it: "slug: {kebab}" in Mono 11.5px `ink-3`.
  2. **Start from.** A grid of cards (`repeat(auto-fill, minmax(104px, 1fr))`): Blank, Dashboard (react), Report (markdown), Diagram (mermaid) and Mini-app (html). Each card shows an icon, a label and the type in Mono. The selected card is `sage-soft` with a `sage-focus` border. Include a "Browse templates →" link.
  3. **Theme.** Shown only when a template is selected. Pill buttons with a three-swatch strip (bg / accent / highlight): Moss, Moss Night, Ledger, Lichen.
  4. **Source.** Textarea, Mono 12.5px/19px, `bg-canvas`, 9 rows, `box-sizing: border-box`. The label shows "Detected {Type}" on the right, using the auto-detect rules below.
- **Validation:** on submit, an empty title or source turns that field's border `danger` and shows an inline error: "Add a title." or "Paste some source to create v1."
- **Footer:** `bg-canvas` with Cancel (ghost) and **Create v1** (primary). Calls `POST /api/artifacts` with tags `template:{id}` and `theme:{id}`.

### Delete dialog
- Width 440px.
- Contents:
  - A 32px `danger-soft` tile with a `Trash2` icon.
  - "Delete "{title}"?"
  - "This permanently removes {n} versions and {k} storage keys from disk. It can't be undone."
  - "Type `{slug}` to confirm" and an input, using a danger focus ring.
- **Delete artifact** (`bg-danger`) stays disabled until the input matches the slug exactly.

### Toast
- Fixed, bottom 24px, centred.
- `bg-ink`, text `canvas`, 13px, radius 10, e2 shadow, with a `Check` icon in `#C7D3C0`.
- Enters over 180ms (fade plus 8px rise). Auto-hides after 2.4s.
- Messages:
  - "Saved v3"
  - "Restored v1 as v3"
  - "Copied v2 source"
  - "Exported {slug}-v{n}.html"
  - "Deleted {title}"
  - "Set {key}"
  - "Deleted key {key}"

---

## Interactions and behaviour
- **Keyboard** (ignored while typing in an input, except where noted):
  - ⌘/Ctrl K: palette
  - ⌘/Ctrl S: save, which also works inside the editor
  - Esc: close any overlay
  - 1–4: Preview / Code / Changes / State
  - N: new artifact
  - J / K: step to the older / newer version
- **Theme:** read `localStorage['ma-studio-theme']`, falling back to `prefers-color-scheme`. Set `document.documentElement.dataset.theme`. Background colour transitions over 0.2s.
- **Version stepping:** selecting the latest version clears the historical state. Opening an older version reloads the content through `GET /versions/:n`, exactly as the code does now.
- **Restore:** `POST /rollback` creates a new version and never overwrites. Afterwards, return to the latest version and set the diff to {new−1 → new}.
- **Diff defaults:** from = latest − 1, to = latest. Both reset when the selected artifact changes.
- **Popovers:** opening one closes the others. Esc closes all of them.
- **Live updates:** keep the existing WebSocket handlers. The status dot in the brand row reflects `wsConnected`.

## State to add to `App.tsx`
- `viewport: 'desktop' | 'tablet' | 'mobile'`
- `verOpen`, `menuOpen`, `paletteOpen`
- `query`, `paletteIndex`
- `confirmDeleteText`
- `toast: string | null`
- `hideUnchanged: boolean`
- `theme: 'day' | 'night'`
- Create form: `template`, `themeId`, `submitted`

Some current state stays but is used differently:
- `selectedVersion` drives the banner and the read-only editor.
- `agentFilter` and `typeFilter` are removed from the UI; search now goes through the palette.

## Agent kit (`designs/agent-kit/`)
- `themes.json`: four themes using the same token names (`--ma-*`), plus a template index.
- `templates/`:
  - `dashboard.tsx`
  - `report.md`
  - `diagram.mmd`
  - `tool.html`
- Each template has a `theme:start` / `theme:end` block. The Mermaid template uses the `%%{init}%%` directive on line 1 instead.
- `kit.js`: `applyTheme()` swaps the theme block and `buildPreview()` mirrors `sandbox-template.ts`.
- `SKILL.md`: an extended version of the current skill, covering workflow, templates, themes, design rules, `window.storage` conventions and a checklist.

Suggested repo changes:
1. `installer.ts`: write `themes.json` and `templates/` next to each `SKILL.md` it installs. Replace `buildUniversalSkillMarkdown()` with the new `SKILL.md`.
2. `sandbox-template.ts`: when an artifact has a `theme:{id}` tag, use that theme's `bg` for the Mermaid and SVG body background.
3. `server.ts`: add `GET /api/templates`, which returns `themes.json` and the template sources, so the New dialog doesn't need to bundle them.

## Assets
- Icons: **lucide-react** (already a dependency). Names are listed in each section above.
- Fonts: IBM Plex Sans (400/500/600), IBM Plex Mono (400/500), and IBM Plex Serif (500/600, used only by the Ledger theme), from Google Fonts.
- Logo: three directions in `designs/Logo.dc.html` (1a version stack, 1b checkpoint frame, 1c shared facet). None has been chosen yet; until one is, use the `Layers` icon on a sage tile.

## Files
- `designs/MyArtifact Studio v2.dc.html`: the main design. Includes the day/night theme and all of the interactions above.
- `designs/Design System.dc.html`: foundations, components and UX rationale.
- `designs/Artifact Templates.dc.html`: live gallery of templates × themes, and the agent instructions.
- `designs/Logo.dc.html`: logo directions.
- `designs/agent-kit/`: themes, templates, `SKILL.md` and `kit.js`.
- `designs/support.js`: the runtime needed to open the `.dc.html` files locally.
