---
name: myartifact
description: >-
  Create, version, inspect, and persist interactive visual artifacts (React components,
  HTML dashboards, Mermaid diagrams, SVG graphics, and Markdown reports) locally across
  Claude Code, Codex, and Antigravity. Activate when generating visual documents,
  UI prototypes, charts, or interactive mini-apps.
---

# MyArtifact — Cross-Assistant Visual Artifact Skill

Use **MyArtifact** whenever you generate substantial visual documents, interactive React apps, data dashboards, diagrams, or stateful mini-tools that benefit from live rendering, version history (`v1`, `v2`, ...), and persistent local storage.

## 1. Preferred Integration: MCP Tools (If Available)
If the `myartifact` MCP server is mounted, call its tools directly:
- `artifact_create`: Create a new artifact (`title`, `slug`, `type`, `content`, `agent`, `tags`, `upsert: true`).
- `artifact_update`: Iterate on an existing artifact by `id` or `slug`, recording a new version checkpoint (`v2`, `v3`...) with a `summary`.
- `artifact_get`: Read an artifact's current or historical source code and its `window.storage` data.
- `artifact_list`: Search local artifacts created by `claude-code`, `codex`, or `antigravity`.
- `artifact_storage_set`: Seed or update key-value state for an interactive artifact.

## 2. CLI Integration (Always Available)
If MCP tools are not mounted in the current session, use the CLI:
```bash
# Create or update an artifact from a file (auto-infers type & increments version if slug exists)
node "/home/tannedcung/side_proj/MyArtifact/dist/cli/cli.js" push ./dashboard.tsx --id revenue-dashboard --title "Revenue Dashboard" --agent antigravity --summary "Added Q4 breakdown"

# List all local artifacts across assistants
node "/home/tannedcung/side_proj/MyArtifact/dist/cli/cli.js" list

# Read an artifact's source or specific version
node "/home/tannedcung/side_proj/MyArtifact/dist/cli/cli.js" get revenue-dashboard --version 1
```

## 3. Claude-Compatible Sandbox Capabilities

### Supported Artifact Types (`type`)
- `react` (`.tsx` / `.jsx`): Compiled in-browser with Babel + TypeScript + JSX.
  - Must export a default React component: `export default function App() { ... }`
  - **Styling**: **Tailwind CSS** is pre-loaded globally.
  - **Pre-installed ESM Libraries** available via standard `import`:
    - `react`, `react-dom/client`
    - `lucide-react` (Icons)
    - `recharts` (Interactive charts)
    - `d3`, `three`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`
- `html` (`.html`): Full HTML/CSS/JS single-file applications (Tailwind & `window.storage` pre-injected).
- `mermaid` (`.mmd`): Flowcharts, sequence diagrams, state & ER diagrams.
- `svg` (`.svg`): Scalable vector graphics.
- `markdown` (`.md`): GitHub Flavored Markdown with embedded ```mermaid blocks and KaTeX math.

### Persistent State API (`window.storage`)
Interactive React and HTML artifacts can persist up to **20 MB** of local state across sessions using the Claude Artifacts-compatible async `window.storage` API:
```tsx
// Read key
const item = await window.storage.get('user_prefs');
const prefs = item ? JSON.parse(item.value) : { theme: 'dark' };

// Write key
await window.storage.set('user_prefs', JSON.stringify(prefs));

// Delete key
await window.storage.delete('user_prefs');

// List keys by prefix
const { keys } = await window.storage.list('note:');
```
