import type { ArtifactStore } from './storage.js';

export function seedStarterArtifacts(store: ArtifactStore): void {
  const existing = store.listArtifacts({ limit: 1 });
  if (existing.length > 0) return;

  // 1. Stateful React Dashboard (Claude Code) with window.storage + Recharts + Lucide
  const reactV1 = `import React, { useState, useEffect } from 'react';
import { Activity, Plus, Trash2, CheckCircle2, Sparkles, Database } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const INITIAL_METRICS = [
  { day: 'Mon', tokens: 14200, artifacts: 3 },
  { day: 'Tue', tokens: 21500, artifacts: 5 },
  { day: 'Wed', tokens: 18900, artifacts: 4 },
  { day: 'Thu', tokens: 32400, artifacts: 8 },
  { day: 'Fri', tokens: 28100, artifacts: 7 },
];

export default function AgentWorkspaceDashboard() {
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadState() {
      try {
        const saved = await window.storage.get('workspace_notes');
        if (saved && saved.value) {
          setNotes(JSON.parse(saved.value));
        } else {
          const defaults = [
            { id: 1, text: 'Compare Claude Code & Antigravity latency', done: true },
            { id: 2, text: 'Test persistent window.storage across refreshes', done: false },
          ];
          setNotes(defaults);
          await window.storage.set('workspace_notes', JSON.stringify(defaults));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoaded(true);
      }
    }
    loadState();
  }, []);

  async function saveNotes(next) {
    setNotes(next);
    await window.storage.set('workspace_notes', JSON.stringify(next));
  }

  function addNote(e) {
    e.preventDefault();
    if (!input.trim()) return;
    saveNotes([...notes, { id: Date.now(), text: input.trim(), done: false }]);
    setInput('');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Cross-Agent Telemetry & Notes</h1>
              <p className="text-xs text-slate-400">Powered by MyArtifact local sandbox & persistent window.storage</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Database className="w-3.5 h-3.5" />
            {loaded ? 'window.storage synced' : 'Syncing...'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                Weekly Agent Token Velocity
              </h2>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={INITIAL_METRICS}>
                  <defs>
                    <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="tokens" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#tokenGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex flex-col">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Persistent Action Items</h2>
            <form onSubmit={addNote} className="flex gap-2 mb-4">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Add persistent note..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
              />
              <button type="submit" className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white">
                <Plus className="w-4 h-4" />
              </button>
            </form>
            <div className="space-y-2 flex-1 overflow-auto">
              {notes.map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs">
                  <button
                    onClick={() => saveNotes(notes.map((x) => x.id === n.id ? { ...x, done: !x.done } : x))}
                    className="flex items-center gap-2 text-left flex-1"
                  >
                    <CheckCircle2 className={\`w-4 h-4 \${n.done ? 'text-emerald-400' : 'text-slate-600'}\`} />
                    <span className={n.done ? 'line-through text-slate-500' : 'text-slate-200'}>{n.text}</span>
                  </button>
                  <button
                    onClick={() => saveNotes(notes.filter((x) => x.id !== n.id))}
                    className="text-slate-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

  const createdReact = store.createArtifact({
    slug: 'agent-telemetry-dashboard',
    title: 'Cross-Agent Telemetry & Notes Dashboard',
    description: 'Interactive React dashboard with Recharts, Lucide icons, and persistent window.storage state.',
    type: 'react',
    language: 'tsx',
    content: reactV1,
    agent: 'claude-code',
    project: 'myartifact-demo',
    tags: ['react', 'dashboard', 'recharts', 'storage'],
    summary: 'v1: Initial telemetry chart and persistent checklist',
  });

  // Create a v2 update on the React artifact so version timeline & diff viewer work immediately out of the box!
  const reactV2 = reactV1.replace(
    "{ day: 'Fri', tokens: 28100, artifacts: 7 },",
    "{ day: 'Fri', tokens: 28100, artifacts: 7 },\n  { day: 'Sat', tokens: 35900, artifacts: 11 },\n  { day: 'Sun', tokens: 41200, artifacts: 14 },"
  );
  store.updateArtifact(createdReact.id, {
    content: reactV2,
    agent: 'antigravity',
    summary: 'v2: Added weekend token velocity metrics (Sat & Sun)',
  });

  // 2. Architecture Mermaid Diagram (Antigravity)
  store.createArtifact({
    slug: 'multi-agent-architecture',
    title: 'Multi-Agent Local Artifact Pipeline',
    description: 'System architecture showing how Claude Code, Codex, and Antigravity share local visual artifacts.',
    type: 'mermaid',
    language: 'mermaid',
    agent: 'antigravity',
    project: 'myartifact-demo',
    tags: ['architecture', 'mermaid', 'mcp'],
    summary: 'Initial architecture diagram',
    content: `flowchart LR
    subgraph Assistants["AI Coding Assistants"]
        CC["Claude Code"]
        CX["OpenAI Codex"]
        AG["Google Antigravity"]
    end

    subgraph Bridge["Unified Local Bridge"]
        MCP["MCP stdio Server"]
        CLI["myartifact CLI"]
        WATCH["Dropzone File Watcher"]
    end

    subgraph Storage["Private Local Store (~/.myartifact)"]
        SQL[("SQLite + FTS5 Index")]
        DISK["Versioned Files (v1..vN) + state.json"]
    end

    CC & CX & AG --> MCP & CLI & WATCH
    MCP & CLI & WATCH --> SQL & DISK
    SQL & DISK --> UI["Live Sandboxed Browser UI (127.0.0.1:4173)"]`,
  });

  // 3. Interactive HTML Latency Calculator (Codex)
  store.createArtifact({
    slug: 'llm-cost-latency-simulator',
    title: 'LLM Context & Throughput Calculator',
    description: 'Standalone HTML/JS estimator for prompt caching and token streaming latency.',
    type: 'html',
    language: 'html',
    agent: 'codex',
    project: 'myartifact-demo',
    tags: ['calculator', 'html', 'llm'],
    summary: 'Initial interactive calculator',
    content: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 p-8 font-sans">
  <div class="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
    <h1 class="text-lg font-bold text-cyan-400">LLM Streaming Latency Estimator</h1>
    <div class="space-y-4 text-sm">
      <div>
        <label class="block text-slate-400 mb-1">Input Context Tokens: <span id="inVal" class="text-white font-mono">16000</span></label>
        <input id="inTokens" type="range" min="1000" max="200000" step="1000" value="16000" class="w-full accent-cyan-400" />
      </div>
      <div>
        <label class="block text-slate-400 mb-1">Output Generation Tokens: <span id="outVal" class="text-white font-mono">1200</span></label>
        <input id="outTokens" type="range" min="100" max="16000" step="100" value="1200" class="w-full accent-cyan-400" />
      </div>
      <div>
        <label class="block text-slate-400 mb-1">Decode Speed (tok/sec): <span id="spdVal" class="text-white font-mono">85</span></label>
        <input id="speed" type="range" min="20" max="250" step="5" value="85" class="w-full accent-cyan-400" />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800">
      <div class="bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div class="text-xs text-slate-400">Est. Time to First Token (TTFT)</div>
        <div id="ttft" class="text-2xl font-bold text-white font-mono mt-1">0.62s</div>
      </div>
      <div class="bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div class="text-xs text-slate-400">Total Turn Duration</div>
        <div id="total" class="text-2xl font-bold text-cyan-400 font-mono mt-1">14.7s</div>
      </div>
    </div>
  </div>
  <script>
    const els = ['inTokens', 'outTokens', 'speed'].map((id) => document.getElementById(id));
    function update() {
      const inp = Number(els[0].value);
      const out = Number(els[1].value);
      const spd = Number(els[2].value);
      document.getElementById('inVal').textContent = inp.toLocaleString();
      document.getElementById('outVal').textContent = out.toLocaleString();
      document.getElementById('spdVal').textContent = spd;
      const ttft = 0.3 + (inp / 50000);
      const total = ttft + (out / spd);
      document.getElementById('ttft').textContent = ttft.toFixed(2) + 's';
      document.getElementById('total').textContent = total.toFixed(1) + 's';
    }
    els.forEach((el) => el.addEventListener('input', update));
    update();
  </script>
</body>
</html>`,
  });
}
