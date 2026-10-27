---
name: myartifact
description: >-
  Create, version, inspect, and persist interactive visual artifacts (React components,
  HTML dashboards, Mermaid diagrams, SVG graphics, and Markdown reports) locally across
  Claude Code, Codex, and Antigravity. Activate when generating visual documents,
  UI prototypes, charts, or interactive mini-apps. Start from a template and a theme.
---

# MyArtifact — Cross-Assistant Visual Artifact Skill

Use **MyArtifact** whenever you generate substantial visual documents, interactive React apps, data dashboards, diagrams, or stateful mini-tools that benefit from live rendering, version history (`v1`, `v2`, ...), and persistent local storage.

## 1. Workflow

1. **Search first.** Call `artifact_list` (or `myartifact list --query`) for an existing artifact on the same topic. If one exists, update it rather than creating a duplicate.
2. **Pick a template** from the table in section 3 and read its file from `agent-kit/templates/`.
3. **Pick a theme** from section 4 and paste its block between the theme markers.
4. **Replace the sample content** with real content. Keep the structure, tokens and spacing.
5. **Design a custom 32×32 SVG `icon`** for the artifact (or pick a preset icon id) so its standalone page (`/artifacts/<slug>`) displays its own unique browser tab favicon and header emblem.
6. **Create** with a stable kebab-case `slug`, a `title`, your `agent` id, your custom `icon`, and tags `template:<id>` and `theme:<id>`. Report the returned `/artifacts/<slug>` standalone URL to the user.
7. **Iterate** with `artifact_update`. Each call needs a one-line `summary` in the imperative mood, under 72 characters: "Add regional breakdown chart", not "Updated stuff".

## 2. Integration

### MCP tools (preferred)
- `artifact_create`: `title`*, `content`*, `slug`, `type`, `agent`, `project`, `tags`, `icon`, `upsert`
- `artifact_update`: `id`*, `content`*, `title`, `icon`, `summary`, `agent`
- `artifact_get`: `id`*, `version`, `includeStorage`
- `artifact_list`: `query`, `agent`, `type`, `project`, `limit`
- `artifact_storage_set`: `id`*, `key`*, `value`*

```json
{
  "tool": "artifact_create",
  "arguments": {
    "slug": "weekly-metrics",
    "title": "Weekly Metrics Dashboard",
    "type": "react",
    "agent": "claude-code",
    "project": "my-project",
    "tags": ["template:dashboard", "theme:moss"],
    "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" fill=\"none\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#E4EADF\"/><rect x=\"6\" y=\"18\" width=\"5\" height=\"8\" rx=\"1.5\" fill=\"#8FA28A\"/><rect x=\"13.5\" y=\"13\" width=\"5\" height=\"13\" rx=\"1.5\" fill=\"#55684F\"/><rect x=\"21\" y=\"7\" width=\"5\" height=\"19\" rx=\"1.5\" fill=\"#C8A96B\"/></svg>",
    "content": "<contents of agent-kit/templates/dashboard.tsx, edited>",
    "upsert": true
  }
}
```

### CLI (always available)
```bash
myartifact push ./weekly-metrics.tsx --id weekly-metrics --title "Weekly Metrics Dashboard" \
  --agent claude-code --tags "template:dashboard,theme:moss" --icon dashboard --summary "Initial dashboard"
myartifact list --query "metrics"
myartifact get weekly-metrics --version 1
```

## 3. Templates

| id | type | file | use for |
| :-- | :-- | :-- | :-- |
| `dashboard` | react | `templates/dashboard.tsx` | 2–4 KPIs, one trend chart, a persistent side panel |
| `report` | markdown | `templates/report.md` | Findings write-up: summary callout, table, diagram, next steps |
| `diagram` | mermaid | `templates/diagram.mmd` | Architecture or flow with grouped subsystems |
| `tool` | html | `templates/tool.html` | Single-purpose calculator or form that remembers inputs |

If nothing fits, start from the closest template and keep its theme block and base CSS.

## 4. Themes

All themes share one token set, exposed as CSS custom properties. The full values are in `agent-kit/themes.json`.

| id | mode | use for |
| :-- | :-- | :-- |
| `moss` | light | Default. Dashboards, tools, daily-use views |
| `moss-night` | dark | Dense monitoring, code-heavy tools |
| `ledger` | light, serif headings | Reports and memos read top to bottom |
| `lichen` | light, soft | Diagrams and overviews shown to others |

Tokens: `--ma-bg`, `--ma-surface`, `--ma-sunken`, `--ma-border`, `--ma-ink`, `--ma-muted`, `--ma-accent`, `--ma-accent-ink`, `--ma-accent-soft`, `--ma-highlight`, `--ma-highlight-soft`, `--ma-danger`, `--ma-font-sans`, `--ma-font-display`, `--ma-font-mono`.

**How to apply a theme**
- React / HTML / Markdown: replace everything between `/* theme:start */` and `/* theme:end */`. In React, also update the `THEME` object (chart colours, grid, axis, surface). Recharts needs hex values, not CSS variables.
- Mermaid: replace line 1, the `%%{init: …}%%` directive.
- In Tailwind, reference tokens with arbitrary values such as `bg-[var(--ma-surface)]` and `text-[var(--ma-muted)]`. Never hard-code a hex value outside the theme block.

## 5. Design rules

- **Hierarchy:** one page title (28px, display font), section headings at 14px semibold, body text at 13–14px. Use the mono font for numbers, codes and eyebrow labels (11px, uppercase, 0.08em tracking).
- **Colour:** `accent` is for primary actions and positive change, `highlight` for emphasis or a second series, and `danger` only for errors or negative change. Use one accent per view. Don't use gradients.
- **Surfaces:** cards are `surface` with a 1px `border` and a 10px radius. Nest content inside `sunken`, not more borders. Shadows are optional and subtle.
- **Spacing:** use a 4px grid: 16px inside cards, 16–24px between cards, a maximum content width of about 64rem.
- **Charts:** one message per chart. Use the series colours in `THEME.chart` order, use the border colour for gridlines, and leave out vertical gridlines.
- **Content:** real data, no lorem ipsum, no decorative stats or emoji. Empty states say what will appear and how to add it.
- **Accessibility:** text needs 4.5:1 contrast (the theme tokens already meet it). Every icon-only button has an `aria-label`. Inputs have labels.
- **Responsive:** layouts must work from 390px to full width. Use grids that collapse (`grid-cols-1 md:grid-cols-3`), not fixed widths.

## 6. Persistent state (`window.storage`)

```tsx
const item = await window.storage.get('dashboard:notes');
const notes = item ? JSON.parse(item.value) : [];
await window.storage.set('dashboard:notes', JSON.stringify(notes));
await window.storage.delete('dashboard:draft');
const { keys } = await window.storage.list('dashboard:');
```
- Namespace keys as `<template-or-feature>:<name>`.
- Always handle a missing key (first run) and a failed parse.
- Guard with `window.storage?.` so the artifact still renders when exported or opened standalone.
- The limit is 20 MB per artifact. Store data, not rendered HTML.

## 7. Sandbox capabilities

- `react` (`.tsx` / `.jsx`): must `export default` a component. Tailwind is loaded globally. Available imports: `react`, `react-dom/client`, `lucide-react`, `recharts`, `d3`, `three`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`.
- `html` (`.html`): a single file; Tailwind and `window.storage` are injected.
- `mermaid` (`.mmd`): flowchart, sequence, state, ER and class diagrams.
- `svg` (`.svg`): rendered on a grid canvas.
- `markdown` (`.md`): GitHub Flavored Markdown with fenced `mermaid` blocks and KaTeX math. A leading `<style>` block is allowed, and the report template uses it for theming.

## 8. Per-Artifact Custom Icon / Logo (`icon`) & Standalone Page

Every artifact has its own standalone page at `/artifacts/<slug>` with its own **browser tab favicon** and **header emblem** (separate from the MyArtifact studio logo).
- Always craft a custom `32x32` SVG logo (`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">...</svg>`) using the artifact's theme colours and pass it via the `icon` field in `artifact_create` / `artifact_update` (or `--icon` in CLI, or between `/* icon:start */ ... /* icon:end */` in source).
- Built-in preset IDs are also supported: `latex-paper`, `multi-approach`, `grpo-rl`, `roadmap-tracker`, `coder-eval`, `engine-blog`, `llama-lora`, `agent-eval`, `arch-flow`, `release-shield`, `dashboard`, `report`, `diagram`, `tool`, `training`.
- When reporting back to the user, always provide the standalone artifact URL (`http://127.0.0.1:4173/artifacts/<slug>`) rather than the multi-artifact studio dashboard.

## 9. Checklist before you push

- [ ] Started from a template; the theme block is intact and tagged `theme:<id>`
- [ ] Custom 32×32 SVG `icon` (or preset id) provided so the artifact has its own favicon & header logo
- [ ] No hex values outside the theme block
- [ ] Real content; every number has a label and a unit
- [ ] Works at 390px wide
- [ ] Storage keys namespaced, first run handled
- [ ] `summary` describes the change in under 72 characters
- [ ] Reported the direct `/artifacts/<slug>` standalone page URL back to the user
