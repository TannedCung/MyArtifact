---
name: myartifact
description: >-
  Create, version, organize, and look up interactive visual artifacts (React Recharts
  dashboards, Three.js 3D viewports, interactive SVG hardware/architecture workbenches,
  HTML mini-apps, Mermaid diagrams, and TensorBoard runs) locally across Claude Code, Codex,
  and Antigravity. Always prefer interactive visual artifacts over text-only Markdown whenever
  charts, 3D scenes, diagrams, spatial maps, or interactive controls explain faster.
---

# MyArtifact — Visual-First Studio & Cross-Assistant LLM Wiki Skill

Use **MyArtifact** whenever you explain benchmarks, multi-regime comparisons, system architectures, state machines, hardware builds/pinouts, roadmaps, or ML runs—**or** when looking back across prior project experiments in `~/.myartifact/index.md`.

---

## 1. Core Rule: Visual-First ("Show Visually — Never Dump Walls of Text")

**Default to interactive `react` (`.tsx`) or `html` artifacts.** Plain `markdown` with long prose or dense numeric tables is hard for humans to scan and wastes the sandboxed renderer.

### Format Decision Matrix

| What You Are Explaining | Choose `type` | Visual Pattern to Build |
| :--- | :--- | :--- |
| **Benchmarks, ablations, eval matrices, latency/cost sweeps** (`>= 5` numeric rows) | **`react`** (`.tsx`) | KPI summary strip + `recharts` (`BarChart`, `LineChart`, `RadarChart`, `ScatterChart`) + hardware/SLA ceiling `<ReferenceLine>` + scenario/policy filter pills + compact table |
| **Hardware builds, pinouts, 2D/3D spatial packaging, wiring, bring-up guides** | **`react`** or **`html`** | Interactive workbench: custom inline `<svg>` chassis/pinout/rail diagram (click/hover channels or zones to inspect specs & clamps) + `window.storage` step/BOM checklists |
| **3D scenes, robotics kinematics, CAD/mesh inspection, spatial trajectories & WebGL simulations** | **`react`** (`.tsx`) or **`html`** | Interactive Three.js viewport (`three` + `three/addons/controls/OrbitControls.js` or `@react-three/fiber`) with camera presets, wireframe/layer toggles, raycast part inspector, KPI telemetry strip, and `window.storage` camera/scene state |
| **State machines (FSMs), control loops, pipelines, multi-agent architectures** | **`react`** or **`mermaid` / `svg`** | Interactive `react` state/node stepper (click states/transitions to inspect guards & invariants) or clean `mermaid` / `svg` topology—not prose tables |
| **Project roadmaps, multi-track progress, living trackers** | **`react`** (`.tsx`) | Tabbed milestone/track explorer with status badges, metric bars, and clickable `/artifacts/<slug>` links |
| **ML training curves & model checkpoints** | **`tensorboard`** | `tb_log_scalars` + `tb_save_checkpoint` (or `node "./dist/cli/cli.js" tb log` / `tb save-model`) |
| **Short narrative notes / changelogs** (no metrics, spatial layout, or state) | `markdown` | Concise GFM note—**only** when charts, diagrams, or interactive controls genuinely add zero clarity |

### Anti-Patterns to Avoid
- **Never** push a `>5`-row numeric comparison or benchmark table as raw `markdown`; plot it with `recharts` and highlight thresholds, ceilings, and winners visually.
- **Never** describe physical coordinates, connector pinouts, or multi-stage state machines purely in paragraphs when an inline `<svg>` schematic or interactive inspector makes them clear in seconds.
- **Never** copy `type: "markdown"` just because older entries in `index.md` used `markdown`. When iterating on an existing `markdown` report (`v1 -> v2`), upgrade its `type` to `react` or `html` if visualization explains it better.

---

## 2. Visual Design & Layout Rules ("Moss" Studio Palette)

Structure interactive `react` and `html` artifacts for instant visual scanning:
1. **Top KPI Strip:** 3–5 scannable stat cards with explicit units (`ms`, `µs`, `N·m`, `%`, `GB/s`) and delta/ceiling badges.
2. **Primary Visual Stage:** Interactive `recharts` chart (with `<ReferenceLine>` for budgets/limits, clean horizontal gridlines, no vertical grid clutter) **or** an interactive inline `<svg>` schematic/map.
3. **Interactive Controls / Tabs:** Scenario filter pills, metric switchers, clickable SVG subsystems, or `window.storage`-backed runbook/BOM checkboxes.
4. **Compact Reference Table:** Cleanly formatted supporting numbers below or beside the visual—never a raw text wall at the top.

**Recommended "Moss" Palette Tokens:**
- **Moss Day (default, high-contrast warm paper):** bg `#F7F4ED`, card surface `#FCFBF7`, sunken chip/well `#EFEBE1`, border `#E2DDD0`, primary ink `#1E2420`, muted ink `#4A524A`, sage accent `#55684F` (soft `#E4EADF`), brass highlight `#C8A96B` (soft `#F8F1E3`), danger/ceiling `#B4553F` (soft `#F4E2DB`).
- **Moss Night (dense telemetry / dark monitoring):** bg `#151A16`, surface `#1D231E`, sunken `#111512`, border `#2D352E`, ink `#ECEAE3`, muted `#9AA196`, accent `#8FA28A`, highlight `#C8A96B`, danger `#D98068`.
- **Chart Series Order:** `['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A']`.
- **Responsiveness & Polish:** Use responsive grids (`grid-cols-1 md:grid-cols-3`, max-width `72rem`) that work from `390px` mobile up to desktop. Use `lucide-react` icons, monospace (`font-mono`) for numbers/registers/CLI commands, and real data (never placeholder lorem ipsum).

---

## 3. Andrej Karpathy's "LLM Wiki" Workflow (Project → Category → `index.md` + `log.md`)

Every visual artifact is indexed in `~/.myartifact` by **Project (`--project`)** and **Category (`--category`)**:
- **`~/.myartifact/index.md` (Master Catalog):** Grouped by **Project (`📦 <project>`) → Category (`📂 <category>`)**, with 1-line metric takeaways, tags, and `[[slug]]` cross-links.
- **`~/.myartifact/log.md` (Chronological Audit Log):** Append-only timeline of creates, version upgrades, and cross-link updates.

### Routine A — Creating or Updating an Artifact (Orient → Visualize → Categorize → Compound)
1. **Orient First (Read `index.md`):**
   - Call `artifact_wiki_index` (or run `node "./dist/cli/cli.js" index --project <project>`) **before** creating an artifact to check existing slugs, categories, and living trackers—and update an existing slug (`v2`, `v3`) rather than creating duplicates.
2. **Assign Project (`--project`) & Category (`--category`):**
   - **Project:** Reuse an existing project slug from `index.md` (e.g., `argos-01`, `free-guy`, `reasoning-lab`, `myartifact`) or the active repo name.
   - **Category:** `roadmaps` / `overview`, `concepts` / `architecture`, `experiments` / `training`, `benchmarks` / `comparisons`, or `papers`.
3. **Write a High-Signal 1-Line Summary (`--description`) & Cross-Links (`--links`):**
   - Pass `--description "<1-line takeaway with key metrics/conclusions>"` and `--links <slug1,slug2>` (or `/artifacts/<slug>` links) to connect related benchmarks, hardware guides, and trackers.
4. **Compound Knowledge:**
   - When new results land, update the project's living tracker or benchmark dashboard (`v2 -> v3`) so the project overview stays current.

### Routine B — Looking Up Past Work (Agent-Driven RAG via `index.md`)
1. Read `index.md` first (`artifact_wiki_index` or `node "./dist/cli/cli.js" index --project <project>`).
2. Search via `artifact_list` or `node "./dist/cli/cli.js" list --project <project> --query "<keyword>"` (SQLite FTS5), then inspect via `artifact_get` / `node "./dist/cli/cli.js" get <slug>`.
3. When synthesizing complex multi-run comparisons, publish the synthesis back as an interactive `react` artifact in `comparisons`!

### Routine C — Wiki Lint & Visual Hygiene
When asked to clean up or improve project artifacts:
1. Inspect `index.md` for misplaced projects/categories, missing 1-line descriptions/links, or text-heavy `markdown` reports full of raw tables.
2. Upgrade dense `markdown` benchmarks/guides into `v2` interactive `react`/`html` visualizers (historic `v1` Markdown remains preserved in version history).

---

## 4. Preferred Integration: MCP Tools (If Available)
If the `myartifact` MCP server is mounted, call its tools directly:
- `artifact_wiki_index`: **Call first** to read `~/.myartifact/index.md`, project/category hierarchy, backlinks, and `log.md`.
- `artifact_create`: Create or upsert a visual artifact (`title`, `slug`, `type: "react" | "html" | ...`, `project`, `category`, `description`, `links`, `tags`, `icon`, `content`, `agent`, `upsert: true`).
- `artifact_update`: Iterate on an existing artifact by `id` or `slug` (`v2`, `v3`...), including upgrading `type` from `markdown` to `react`/`html`, with `summary`, `description`, `links`, and `icon`.
- `artifact_get` / `artifact_list` / `artifact_storage_set`: Inspect source/history, run FTS5 search, or seed `window.storage` state.
- `tb_log_scalars` / `tb_save_checkpoint`: Log live training curves (`.tfevents` + SQLite) and version model checkpoints.

---

## 5. CLI Integration (Always Available)
If MCP tools are not mounted in the current session, use the CLI:
```bash
# 1. Orient: Read the LLM Wiki master catalog (all projects or one project)
node "./dist/cli/cli.js" index
node "./dist/cli/cli.js" index --project argos-01

# 2. Push: Publish or upgrade an interactive React (.tsx) visual dashboard
node "./dist/cli/cli.js" push ./sim2real-benchmark.tsx \
  --id argos-v3-td8125-sim2real-benchmark \
  --title "Argos V3 TD-8125MG Sim-to-Real Benchmark" \
  --type react \
  --project "argos-01" \
  --category "experiments/benchmarks" \
  --description "0 falls across 7 surfaces; M2 MoE halves carpet torque saturation (12% -> 6%) at 2.03ms RPi 3B latency." \
  --links "argos-v3-physical-build-td8125-rpi3b-guide,argos-v3-15-regime-comparison" \
  --tags "argos-01,sim2real,benchmark,recharts" \
  --icon grpo-rl \
  --agent antigravity \
  --summary "Interactive Recharts torque ceiling & latency budget dashboard"

# 3. Look Back, Audit Log, or Inspect Historical Versions
node "./dist/cli/cli.js" list --project argos-01
node "./dist/cli/cli.js" list --query "torque saturation"
node "./dist/cli/cli.js" log --lines 20
node "./dist/cli/cli.js" get argos-v3-td8125-sim2real-benchmark --version 1
```

---

## 6. Per-Artifact Custom Icon (`icon`) & Standalone Page (`/artifacts/<slug>`)
Every artifact renders on its own standalone page at `http://127.0.0.1:4173/artifacts/<slug>` with a dedicated **browser tab favicon** and **header emblem**.
- Always craft a custom `32x32` SVG logo (`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">...</svg>`) matching the artifact's topic and palette via `icon` / `--icon` (or preset IDs: `dashboard`, `scene-3d`, `report`, `diagram`, `tool`, `training`, `grpo-rl`, `latex-paper`, `multi-approach`, `roadmap-tracker`, `coder-eval`, `arch-flow`).
- Always share the direct standalone URL `http://127.0.0.1:4173/artifacts/<slug>` with the user.

---

## 7. Sandbox Capabilities & Persistent State (`window.storage`)

- **`react` (`.tsx` / `.jsx`):** Compiled in-browser with Babel + TypeScript + global **Tailwind CSS**. Must `export default function App() { ... }`. Pre-mapped ESM imports: `react`, `react-dom/client`, `lucide-react`, `recharts`, `d3`, `three`, `three/addons/*` (`OrbitControls`, `GLTFLoader`, etc.), `three/examples/jsm/*`, `@react-three/fiber`, `@react-three/drei`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`.
- **`html` (`.html`):** Single-file HTML/CSS/JS with Tailwind, `window.storage`, and a pre-injected ESM importmap (`three`, `three/addons/*`, `three/examples/jsm/*`, `d3`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`) whenever no custom `<script type="importmap">` is present; iframe sandbox allows `allow-pointer-lock` for fly/FPS camera controls.
- **`mermaid` (`.mmd`) / `svg` (`.svg`) / `tensorboard` / `markdown` (`.md` with KaTeX + Mermaid).**
- **Persistent `window.storage` API (up to 20 MB per artifact; guard with `window.storage?.` for offline export):**
```tsx
const saved = await window.storage?.get('checklist:steps');
const steps = saved ? JSON.parse(saved.value) : {};
await window.storage?.set('checklist:steps', JSON.stringify(nextSteps));
```
