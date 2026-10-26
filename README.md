# MyArtifact

**MyArtifact** is a 100% local, private, cross-assistant visual artifact studio and storage engine for **Claude Code**, **Codex**, and **Antigravity**.

It brings the full **Claude Web Artifacts** experience—live sandboxed React/HTML/Mermaid/Markdown/SVG rendering, automatic version timelines (`v1`, `v2`, `v3`...), side-by-side code diffs, and persistent `window.storage` mini-app state—to your local machine and shares a unified library across all your terminal and IDE coding assistants.

---

## Features

- **Claude-Compatible Sandboxed Renderer**:
  - **React (`.tsx` / `.jsx`)**: Live in-browser Babel + TypeScript compilation with pre-bundled **Tailwind CSS**, `lucide-react`, `recharts`, `d3`, `three`, `lodash`, `papaparse`, `mathjs`, and `canvas-confetti`.
  - **HTML / CSS / JS**: Single-file web apps with `window.storage` and Tailwind injected.
  - **Mermaid & SVG**: Interactive vector diagrams and architecture blueprints.
  - **Markdown**: GitHub Flavored Markdown with embedded `mermaid` blocks and KaTeX math.
- **Immutable Version History & Diffs**:
  - Every iteration creates a version checkpoint (`v1`, `v2`, `v3`...) with instant timeline stepping, line-by-line diff inspection, and one-click rollback.
- **Persistent Local State (`window.storage`)**:
  - Implements Claude Artifacts' async `window.storage.get / set / delete / list` API backed by local SQLite and `state.json` (up to 20 MB per artifact) with a live **State Inspector** tab in the UI.
- **Hybrid Human-Readable + SQLite Storage**:
  - Stored by default in `~/.myartifact/` (`artifacts/<slug>/current.<ext>`, `versions/v1.<ext>`, `meta.json`, `state.json`) indexed by Node's native `node:sqlite` with FTS5 full-text search.
- **Universal Cross-Assistant Bridge**:
  - **MCP Server (`myartifact mcp`)**: Exposes `artifact_create`, `artifact_update`, `artifact_get`, `artifact_list`, and `artifact_storage_set`.
  - **CLI (`myartifact push`, `list`, `get`, `serve`, `setup`)**: Publish or inspect artifacts from any shell or hook.
  - **Dropzone File Watcher**: Drop or edit files in `~/.myartifact/dropzone/` (or any watched folder) for instant auto-versioning and WebSocket hot-reload.
  - **Skill & MCP Installer (`myartifact setup`)**: Generates `.agents/skills/myartifact/SKILL.md`, `.claude/skills/myartifact/SKILL.md`, and `.mcp.json`.

---

## Quick Start

### Option A: Docker Deployment (Recommended for Always-On Local Service)
```bash
# Build and start the background container (mounts ~/.myartifact to /data)
docker compose up -d --build

# Check container status and logs
docker compose ps
docker compose logs -f
```

### Option B: Direct Node.js Execution
```bash
# 1. Build the server, CLI, MCP server, and Web UI
npm run build

# 2. Install skills & MCP configuration for Antigravity, Claude Code, and Codex
node dist/cli/cli.js setup

# 3. Start the local visual studio & daemon (http://127.0.0.1:4173)
npm start
```

## CLI Usage

```bash
# Push a new or updated artifact from any coding assistant
node dist/cli/cli.js push ./dashboard.tsx \
  --id revenue-dashboard \
  --title "Revenue Dashboard" \
  --agent claude-code \
  --summary "Initial Q4 forecast"

# List all stored artifacts
node dist/cli/cli.js list

# Fetch source code or JSON metadata for a specific version
node dist/cli/cli.js get revenue-dashboard --version 1
```
