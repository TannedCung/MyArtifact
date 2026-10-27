---
name: myartifact
description: >-
  Create, version, organize, and look up interactive visual artifacts (React components,
  HTML dashboards, LaTeX reports, Mermaid diagrams, SVG graphics, Markdown notes, and
  TensorBoard runs) locally across Claude Code, Codex, and Antigravity using Andrej
  Karpathy's LLM Wiki pattern (index.md + log.md + structured categories + cross-links).
---

# MyArtifact — Cross-Assistant Visual Artifact & LLM Wiki Skill

Use **MyArtifact** whenever you generate substantial visual documents, interactive React apps, multi-track progress trackers, LaTeX papers, data dashboards, diagrams, or stateful mini-tools, **or** when looking back across past project experiments and reports.

---

## 1. Best Practice: Andrej Karpathy's "LLM Wiki" Workflow (`index.md` + `log.md`)

As the number of artifacts grows, flat unorganized files become hard to look back on. You act as the **LLM Wiki Librarian** for `~/.myartifact`:
- **`~/.myartifact/index.md` (Master Catalog):** Content-oriented map of every artifact grouped by hierarchical `category`, with 1-line summaries, tags, and `[[slug]]` cross-links.
- **`~/.myartifact/log.md` (Chronological Audit Log):** Append-only timeline of every create, update, category placement, and link operation.

### Routine A — Creating or Updating an Artifact (Orient → Place → Link → Push)
1. **Orient First (Read `index.md`):**
   - Run `node "./dist/cli/cli.js" index` (or call the `artifact_wiki_index` MCP tool) **before** pushing a new artifact so you know what categories and related artifacts already exist.
2. **Decide Category Placement (`--category`):**
   - Place the artifact into an existing `<domain>/<topic>` folder from `index.md`, or create a clean category following this taxonomy:
     - `concepts/<topic>` — System architecture diagrams, foundational explainers, engineering deep-dives (e.g., `concepts/architecture`).
     - `experiments/<topic>` — Empirical runs, RL/GRPO trackers, multi-approach ablations, TensorBoard runs, eval reports (e.g., `experiments/reasoning`, `experiments/training`, `experiments/benchmarks`).
     - `comparisons/<topic>` — Cross-cutting syntheses, cost/latency simulators, trade-off tables (e.g., `comparisons/tradeoffs`).
     - `papers/<topic>` — Formal LaTeX / arXiv-style technical reports and derivations (e.g., `papers/research`).
     - `roadmaps/<topic>` — Milestone trackers, release checklists, and telemetry boards (e.g., `roadmaps/platform`).
3. **Write a High-Signal 1-Line Summary (`--description`) & Cross-Links (`--links`):**
   - Always pass `--description "<1-line takeaway with key metrics/conclusions>"` so `index.md` captures the core finding without needing to parse 500 lines of HTML/JSX.
   - Always pass `--links <slug1,slug2>` (and/or embed `[[slug]]` or `/artifacts/<slug>` links) to connect related runs, trackers, and papers into a compounding knowledge graph.

### Routine B — Looking Up Past Work (Agent-Driven RAG via `index.md`)
When the user asks a question about prior experiments, metrics, or design decisions:
1. **Read `index.md` First:** Run `node "./dist/cli/cli.js" index` (or `artifact_wiki_index`) to scan categories, 1-line summaries, and `[[wiki-links]]`.
2. **Filter or Full-Text Search:** Use `node "./dist/cli/cli.js" list --category <path>` or `node "./dist/cli/cli.js" list --query "<keyword>"` (backed by SQLite FTS5 across titles, descriptions, tags, categories, links, and code).
3. **Inspect Relevant Artifacts:** Read full content or state via `node "./dist/cli/cli.js" get <slug>` (or `artifact_get`).
4. **Compound Knowledge:** When synthesizing a complex comparison across multiple artifacts, publish the synthesis back as a new artifact in `comparisons/` linked to its sources!

---

## 2. Preferred Integration: MCP Tools (If Available)
If the `myartifact` MCP server is mounted, call its tools directly:
- `artifact_wiki_index`: **Call first** to read `~/.myartifact/index.md`, category hierarchy, backlinks, and `log.md`.
- `artifact_create`: Create or upsert an artifact (`title`, `slug`, `type`, `category`, `description`, `links`, `tags`, `icon`, `content`, `agent`, `upsert: true`).
- `artifact_update`: Iterate on an existing artifact by `id` or `slug`, recording a new version checkpoint (`v2`, `v3`...) with `summary`, `category`, `description`, and `links`.
- `artifact_get`: Read an artifact's current or historical source code and its `window.storage` data.
- `artifact_list`: Search local artifacts by `query`, `category`, `agent`, `type`, or `project`.
- `artifact_storage_set`: Seed or update key-value state for an interactive artifact.

---

## 3. CLI Integration (Always Available)
If MCP tools are not mounted in the current session, use the CLI:
```bash
# 1. Orient: Read the LLM Wiki master catalog (index.md) before creating or looking up
node "./dist/cli/cli.js" index

# 2. Push: Create or update an artifact placed in a structured wiki category with cross-links & custom icon
node "./dist/cli/cli.js" push ./grpo-report.html \
  --id grpo-ablation-report \
  --title "GRPO KL-Penalty Ablation Report" \
  --category "experiments/reasoning" \
  --description "KL beta=0.04 prevents format collapse and reaches 84.1% GSM8K (+6.3% over beta=0.01)." \
  --links "deepseek-r1-grpo-reasoning,multi-approach-reasoning-tracker,latex-reasoning-scaling-paper" \
  --tags "grpo,rl,ablation,gsm8k" \
  --icon grpo-rl \
  --agent antigravity \
  --summary "Initial ablation report with 4 KL penalty sweeps"

# 3. Look Back: Filter by category or full-text search across the wiki
node "./dist/cli/cli.js" list --category experiments/reasoning
node "./dist/cli/cli.js" list --query "KL penalty"

# 4. Audit Trail: View the chronological operation log (log.md)
node "./dist/cli/cli.js" log --lines 20

# 5. Read an artifact's source or specific historical version
node "./dist/cli/cli.js" get grpo-ablation-report --version 1
```

---

## 4. Per-Artifact Custom Icon / Logo (`icon`) & Standalone Page (`/artifacts/<slug>`)
Every artifact has its own standalone Claude Artifact-style page at `http://127.0.0.1:4173/artifacts/<slug>` with its own **browser tab favicon** and **header logo** (distinct from the MyArtifact studio logo).
- Always design a custom `32x32` SVG logo (`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">...</svg>`) matching the artifact's topic and theme palette, and pass it via the `icon` argument (or `--icon` in CLI, or between `/* icon:start */ ... /* icon:end */` in source).
- Built-in preset IDs: `latex-paper`, `multi-approach`, `grpo-rl`, `roadmap-tracker`, `coder-eval`, `engine-blog`, `llama-lora`, `agent-eval`, `arch-flow`, `release-shield`, `dashboard`, `report`, `diagram`, `tool`, `training`.
- When reporting completion to the user, always link directly to `http://127.0.0.1:4173/artifacts/<slug>`.

---

## 5. Claude-Compatible Sandbox Capabilities

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
