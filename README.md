<div align="center">

# MyArtifact

**Local-First, Private, Cross-Assistant Visual Artifact Studio & MCP Server**  
*For **Claude Code**, **OpenAI Codex**, and **Google Antigravity***

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](./LICENSE)
[![Node.js >= 22.5](https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Ready](https://img.shields.io/badge/MCP-Stdio_Server-8A2BE2)](https://modelcontextprotocol.io/)
[![Docker Ready](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)

</div>

---

**MyArtifact** brings the full **Claude Web Artifacts** experience—live sandboxed React/HTML/Mermaid/Markdown/SVG rendering, immutable version timelines (`v1`, `v2`, `v3`...), side-by-side code diffs, and persistent `window.storage` mini-app state—directly to your local machine.

Unlike cloud-locked artifact viewers, **MyArtifact** runs 100% locally and acts as a **unified visual workspace shared across all your terminal and IDE coding assistants** (**Claude Code**, **Codex**, and **Antigravity**). One assistant can generate a `v1` interactive dashboard or architecture diagram, and another assistant (or you) can inspect, iterate, diff, or roll back to `v2` in real time.

---

## Architecture Overview

```mermaid
flowchart LR
    subgraph Assistants["AI Coding Assistants"]
        CC["Claude Code"]
        CX["OpenAI Codex"]
        AG["Google Antigravity"]
    end

    subgraph Bridge["Unified Local Bridge"]
        MCP["MCP Stdio Server\n(myartifact mcp)"]
        CLI["CLI Tool\n(myartifact push / get / list)"]
        WATCH["Dropzone File Watcher\n(~/.myartifact/dropzone)"]
    end

    subgraph Storage["Private Local Store (~/.myartifact)"]
        SQL[("Node SQLite + FTS5\nindex.sqlite")]
        DISK["Human-Readable Files\ncurrent.<ext> • versions/v1..vN • state.json"]
    end

    subgraph Studio["Visual Studio UI (127.0.0.1:4173)"]
        SANDBOX["Sandboxed Iframe Renderer\n(React / HTML / Mermaid / MD / SVG)"]
        DIFF["Version Timeline & Diff Viewer"]
        KV["Live window.storage Inspector"]
    end

    CC & CX & AG --> MCP & CLI & WATCH
    MCP & CLI & WATCH --> SQL & DISK
    SQL & DISK <-->|REST + WebSocket Live Reload| Studio
```

---

## Key Features

### 1. Claude-Compatible Sandboxed Renderer
Every artifact renders inside an isolated browser sandbox with zero build-step friction:
- **React (`.tsx` / `.jsx`)**: Live in-browser Babel + TypeScript compilation with **Tailwind CSS** and pre-mapped ESM libraries ready to `import`:
  - `react`, `react-dom/client`
  - `lucide-react` (Icons)
  - `recharts` (Charts & data visualization)
  - `three`, `three/addons/*` (`OrbitControls`, `GLTFLoader`, post-processing), `three/examples/jsm/*`, `@react-three/fiber`, `@react-three/drei` (3D WebGL/WebGPU visualization)
  - `d3`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`
- **HTML / CSS / JS (`.html`)**: Single-file web applications with Tailwind CSS, `window.storage`, and pre-mapped ESM imports (`three`, `three/addons/*`, `three/examples/jsm/*`, `d3`, `lodash`, `papaparse`, `mathjs`, `canvas-confetti`) automatically injected (unless a custom `<script type="importmap">` is provided).
- **Mermaid Diagrams (`.mmd`)**: Flowcharts, sequence diagrams, architecture graphs, ER & state diagrams.
- **SVG Graphics (`.svg`)**: Responsive vector rendering on a studio grid canvas.
- **Markdown (`.md`)**: GitHub Flavored Markdown with embedded `mermaid` diagram rendering and **KaTeX** math support.
- **Code Snippets**: Clean syntax-formatted fallback for `.ts`, `.py`, `.rs`, `.go`, `.sql`, `.json`, and `.sh`.

### 2. Immutable Version History, Diffs & Rollback
- Every update creates an immutable checkpoint (`v1`, `v2`, `v3`...) tagged with the authoring assistant (`claude-code`, `codex`, `antigravity`, `watcher`, or `user`) and a commit summary.
- Step backward and forward through the version timeline in the header bar.
- Compare any two versions side-by-side in the **Diff** tab with line addition/deletion counts and one-click **Restore `vN`** rollback.

### 3. Persistent Local State (`window.storage`)
Implements the Claude Artifacts-compatible async `window.storage` key-value API so interactive React and HTML mini-apps remember user data across refreshes and sessions:
```tsx
// Read persistent state
const saved = await window.storage.get('workspace_notes');
const notes = saved ? JSON.parse(saved.value) : [];

// Write persistent state (up to 20 MB per artifact)
await window.storage.set('workspace_notes', JSON.stringify(nextNotes));

// Delete a key or list keys by prefix
await window.storage.delete('temp_key');
const { keys } = await window.storage.list('note:');
```
- Backed by both SQLite (`artifact_kv_store`) and a human-readable `state.json` file on disk.
- Inspect, add, edit, or delete keys live from the **State** tab in the Web UI.

### 4. Triple Integration Bridge (MCP + CLI + Dropzone Watcher)
- **MCP Server (`myartifact mcp`)**: Native Model Context Protocol server over `stdio` exposing 8 tools (`artifact_wiki_index`, `artifact_create`, `artifact_update`, `artifact_get`, `artifact_list`, `artifact_storage_set`, `tb_log_scalars`, `tb_save_checkpoint`).
- **CLI (`myartifact push`, `list`, `get`)**: Lightweight shell commands that any agent or script can invoke.
- **Dropzone File Watcher**: Drop or edit any file in `~/.myartifact/dropzone/` (or custom `--watch` directories) to auto-create and version artifacts with instant WebSocket hot-reload.

### 5. Standalone Single-File HTML Export
- Click the **Download** button (or call `GET /api/artifacts/:id/export?download=1`) to bundle any artifact version—including its current `window.storage` snapshot—into a self-contained `.html` file you can share or open offline.

---

## For Humans

> **Prerequisite**: Node.js **>= 22.5.0** (uses Node's native `node:sqlite` module with zero native C++ compilation required) or **Docker** for self-hosted local studio, or any browser for MyArtifact Cloud.

### Option A: Connect to MyArtifact Cloud (Recommended — Zero Server Setup)

1. Open [myartifact.app](https://myartifact.app/) and click **Continue with Google** (Google OIDC) to access your workspace, version diffs, cascading RBAC folders, and Batch Sharing.
2. Link your local terminal & coding assistants to MyArtifact Cloud once (authorized under the **Safe Agent Scope Ceiling**; add `--device` for SSH/headless environments):

```bash
npx myartifact login --cloud https://myartifact.app
```

3. Configure `.mcp.json` and `SKILL.md` for Claude Code, OpenAI Codex, and Google Antigravity, then verify your active Cloud profile:

```bash
npx myartifact setup
npx myartifact whoami
npx myartifact workspace list
```

### Option B: Self-Hosted / Offline Local Studio (Node.js)

```bash
# 1. Install dependencies & build CLI, MCP server, daemon, and Web Studio
npm install
npm run build

# 2. Configure workspace skills (SKILL.md) and MCP config (.mcp.json)
node dist/cli/cli.js setup

# 3. Start the local visual studio & watcher daemon (http://127.0.0.1:4173)
npm start
```

### Option C: Self-Hosted / Offline Local Studio (Docker Compose)

```bash
# Build and start the background container (persists data to ~/.myartifact)
docker compose up -d --build

# Open the studio at http://127.0.0.1:4173
docker compose ps
docker compose logs -f
```

---

## For Agents

Paste this bootstrap instruction into **Claude Code**, **OpenAI Codex**, or **Google Antigravity** (once logged in via `npx myartifact login --cloud https://myartifact.app` and configured with `npx myartifact setup`):

> **Agent Bootstrap Prompt**
> ```text
> Read https://myartifact.app/llms.txt to connect and publish to MyArtifact Cloud.
> Check cloud auth with npx myartifact whoami (if not logged in, ask the human to run npx myartifact login --cloud https://myartifact.app && npx myartifact setup).
> Always call artifact_wiki_index() first, prefer interactive react/html/threejs/mermaid/tensorboard artifacts over plain markdown, iterate with artifact_update + [[wiki-links]], and return the live https://myartifact.app/artifacts/<slug> URL.
> ```

### Agent Operating Protocol

1. **Verify Cloud Connection**: Confirm `npx myartifact whoami` shows `Profile: cloud` and the target workspace (do **not** run `myartifact serve` when targeting Cloud).
2. **Orient first via the Cloud Wiki**: Call `artifact_wiki_index()` to read the workspace LLM Wiki (`index.md` & `log.md`) so new outputs land in the right `project` / `category` and avoid duplicating existing slugs.
3. **Default to Visual-First Runtimes**: Choose `"react"` (Tailwind + Recharts / Lucide), `"html"` (self-contained ES modules / Three.js), `"mermaid"`, `"svg"`, or `tb_log_scalars` even if older entries in the project used markdown. Follow the Moss theme (`#F7F4ED` / `#151A16` canvas, `#485A43` / `#98AC93` sage accents).
4. **Iterate, Cross-Link & Share Cloud URLs**: Use `artifact_update` (or `upsert: true`) rather than spawning duplicate slugs, link related artifacts with `[[other-slug]]`, persist UI state in `window.storage`, and return live `https://myartifact.app/artifacts/<slug>` links.
5. **Respect the Safe Agent Scope Ceiling**: Standard `myartifact login` sessions authorize `artifacts:read`, `artifacts:write`, `storage:write`, and `tb:write`—while destructive deletes (`artifacts:delete`) and permission edits (`iam:share`) remain blocked unless explicitly run with `--elevate`.

### Assistant Auto-Configuration

```bash
# Configure current project workspace (.agents/skills, .claude/skills, .mcp.json)
node dist/cli/cli.js setup

# Also install into global user skill directories (~/.gemini, ~/.claude, ~/.codex)
node dist/cli/cli.js setup --global
```

| Assistant | Generated Skill Path | MCP Configuration |
| :--- | :--- | :--- |
| **Google Antigravity** | `.agents/skills/myartifact/SKILL.md`<br>`~/.gemini/config/skills/myartifact/SKILL.md` | Uses `.mcp.json` or CLI via skill instructions |
| **Claude Code** | `.claude/skills/myartifact/SKILL.md`<br>`~/.claude/skills/myartifact/SKILL.md` | Auto-discovers `.mcp.json` in workspace root |
| **OpenAI Codex** | `.agents/skills/myartifact/SKILL.md`<br>`~/.codex/skills/myartifact/SKILL.md` | Uses CLI or MCP stdio server (`myartifact mcp`) |

### Manual MCP Server Configuration (`.mcp.json`)

```json
{
  "mcpServers": {
    "myartifact": {
      "command": "node",
      "args": ["/absolute/path/to/MyArtifact/dist/cli/cli.js", "mcp"]
    }
  }
}
```

---

## MCP Tools Reference

When mounted as an MCP server (`myartifact mcp`), **MyArtifact** exposes 8 tools to your coding assistant:

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| `artifact_wiki_index` | Read the LLM Wiki master catalog (`index.md`) and operation log (`log.md`). | `project`, `includeLog` |
| `artifact_create` | Create a new artifact (or upsert `vN+1` by `slug`). | `title`*, `content`*, `slug`, `type`, `agent`, `project`, `category`, `tags`, `upsert` |
| `artifact_update` | Update an existing artifact by ID or slug and record `vN+1`. | `id`*, `content`*, `title`, `summary`, `agent`, `category` |
| `artifact_get` | Fetch artifact source code, version history, and `window.storage`. | `id`*, `version`, `includeStorage` |
| `artifact_list` | Full-text search (FTS5) and filter artifacts across assistants. | `query`, `agent`, `type`, `project`, `category`, `limit` |
| `artifact_storage_set` | Seed or update a key-value entry in `window.storage`. | `id`*, `key`*, `value`* |
| `tb_log_scalars` | Stream TensorBoard scalar metrics & write `.tfevents` records. | `run`*, `metrics`*, `step`, `epoch`, `hparams`, `modelName`, `framework`, `status` |
| `tb_save_checkpoint` | Version a trained checkpoint (`.safetensors`, `.pt`, `.onnx`) under a run. | `run`*, `name`, `step`, `sourceFilePath`, `metrics`, `isBest`, `summary` |

---

## CLI Reference

```bash
# Start the local web studio, REST/WebSocket server, and dropzone watcher
node dist/cli/cli.js serve --port 4173 --host 127.0.0.1

# Push a new or updated artifact from a file (auto-infers type & increments version)
node dist/cli/cli.js push ./dashboard.tsx \
  --id revenue-dashboard \
  --title "Q4 Revenue Dashboard" \
  --agent claude-code \
  --tags "react,finance,recharts" \
  --summary "Added regional breakdown chart"

# Search and list stored artifacts
node dist/cli/cli.js list --query "revenue" --agent claude-code

# Output artifact source code (or --json for full metadata + storage)
node dist/cli/cli.js get revenue-dashboard --version 1
node dist/cli/cli.js get revenue-dashboard --json

# Run the MCP server over stdio
node dist/cli/cli.js mcp
```

### Dropzone Directive Comments

When dropping files into `~/.myartifact/dropzone/` (or any directory passed to `myartifact serve --watch <dir>`), you can include optional header comments in the first 15 lines to control metadata automatically:

```tsx
// @title: Latency & Throughput Simulator
// @agent: antigravity
// @project: llm-benchmarks
// @tags: react, charts, latency
// @description: Interactive token streaming calculator
```

---

## On-Disk Storage Layout

By default, all data is stored privately in `~/.myartifact` (override with `MYARTIFACT_HOME` or `--data-dir`):

```text
~/.myartifact/
├── index.sqlite                  # SQLite WAL database + FTS5 full-text search index
├── dropzone/                     # Watched folder for instant drag-and-drop / agent file sync
└── artifacts/
    └── <slug>/
        ├── current.tsx           # Latest version source file (editable in place)
        ├── meta.json             # Human-readable metadata & version manifest
        ├── state.json            # Synced window.storage key-value snapshot
        └── versions/
            ├── v1.tsx            # Immutable v1 checkpoint
            └── v2.tsx            # Immutable v2 checkpoint
```

---

## REST & WebSocket API

The local server (`http://127.0.0.1:4173`) exposes a clean JSON API and WebSocket feed (`/ws`):

- `GET /api/health` — Server health and active storage paths
- `GET /api/artifacts?q=&agent=&type=&project=&tag=` — Search and filter artifacts
- `POST /api/artifacts` — Create (or upsert) an artifact
- `GET /api/artifacts/:idOrSlug` — Get artifact detail, version history, and storage entries
- `PUT /api/artifacts/:idOrSlug` — Save a new version iteration
- `DELETE /api/artifacts/:idOrSlug` — Delete an artifact and all its versions
- `GET /api/artifacts/:idOrSlug/versions/:version` — Get raw content for a specific version
- `GET /api/artifacts/:idOrSlug/diff?from=1&to=2` — Compute unified diff patch between versions
- `POST /api/artifacts/:idOrSlug/rollback` — Roll back to a historical version as a new checkpoint
- `GET /api/artifacts/:idOrSlug/export?version=1&download=1` — Export standalone single-file HTML
- `GET | PUT | DELETE /api/artifacts/:idOrSlug/storage` — Inspect or mutate `window.storage` state

---

## Deploy to Cloud on Vercel Hobby ($0/mo)

MyArtifact includes a stateless serverless cloud mode (`Google OIDC + RBAC + Batch Sharing + Local CLI Login`) designed to run at `$0/month` on **Vercel Hobby** paired with Serverless PostgreSQL (e.g., **Neon Free Tier**):

- **Stateless Compute (`api/index.js`)**: No permanent WebSockets or Postgres `LISTEN` connections are kept open — Web Studio automatically uses conditional HTTP **Stateless Sync** (`GET /api/sync` with `ETag` / `304 Not Modified`) when focused or active, while static SPA assets serve from Vercel's CDN.
- **Single Master Secret**: Set one `MYARTIFACT_SECRET` to deterministically derive ES256 JWT keys, cookie HMAC keys, and signed blob URLs across cold starts.
- **Zero-Config Blobs (`cloud_blobs`) + Optional R2/S3**: Artifact contents fall back to PostgreSQL `cloud_blobs` when S3 env vars are omitted, or set `MYARTIFACT_S3_*` for direct-to-R2/S3 pre-signed binary uploads (>4.5 MB model checkpoints).

### Quick Deploy

1. Copy `.env.example` and provision:
   - `DATABASE_URL` — Neon Postgres pooled (`-pooler`) connection string
   - `MYARTIFACT_SECRET` — generate with `openssl rand -hex 32`
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` — set Authorized Redirect URI to `https://<your-app>.vercel.app/api/auth/google/callback`
2. Add those variables in **Vercel Project Settings -> Environment Variables** and deploy:
   ```bash
   npx vercel --prod
   ```
3. Log in once from your terminal so local coding agents (**Claude Code**, **Codex**, **Antigravity**) share your cloud identity under the default safe scope ceiling:
   ```bash
   myartifact login --cloud https://<your-app>.vercel.app
   ```

See [docs/cloud-deployment.md](docs/cloud-deployment.md) for the full serverless + Postgres + R2/S3 + DNS deployment methodology.

---

## Development & Testing

```bash
# Run backend server in watch mode (port 4173)
npm run dev:server

# Run Vite frontend dev server with HMR proxy (port 5173)
npm run dev:web

# Type-check with TypeScript
npx tsc --noEmit

# Run the test suite (storage, MCP tools, REST API, watcher, installer)
npm test

# Build production bundles into dist/
npm run build
```

---

## License

Released under the [MIT License](./LICENSE). Copyright © 2026 [TannedCung](https://github.com/TannedCung).
