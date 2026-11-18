import type { ArtifactStore } from './storage.js';

export function seedStarterArtifacts(store: ArtifactStore): void {
  const existing = store.listArtifacts({ limit: 1 });
  if (existing.length > 0) {
    if (!store.getArtifact('qwen-coder-lora-run')) {
      seedTensorBoardDemoRun(store);
    }
    if (!store.getArtifact('threejs-kinematic-workbench')) {
      seedThreeJsDemoArtifact(store);
    }
    return;
  }

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

  // 4. TensorBoard Training Run & Saved Model Checkpoints
  seedTensorBoardDemoRun(store);

  // 5. Interactive Three.js 3D Kinematic & Shader Studio Workbench
  seedThreeJsDemoArtifact(store);
}

function seedTensorBoardDemoRun(store: ArtifactStore): void {
  const baseTime = Math.floor(Date.now() / 1000) - 3600;
  const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  const trainLoss = [2.14, 1.72, 1.41, 1.18, 0.99, 0.85, 0.74, 0.66, 0.59, 0.54];
  const valLoss = [2.05, 1.68, 1.39, 1.19, 1.02, 0.88, 0.79, 0.71, 0.65, 0.61];
  const valAcc = [0.42, 0.54, 0.63, 0.71, 0.77, 0.82, 0.86, 0.89, 0.915, 0.932];
  const lr = [2e-4, 1.95e-4, 1.85e-4, 1.7e-4, 1.5e-4, 1.25e-4, 1e-4, 7.5e-5, 5e-5, 2.5e-5];

  for (let i = 0; i < steps.length; i++) {
    store.logTensorBoardScalars({
      slug: 'qwen-coder-lora-run',
      title: 'Qwen2.5-Coder-7B LoRA Fine-Tuning',
      experiment: 'code-agent-sft',
      modelName: 'Qwen2.5-Coder-7B-Instruct-LoRA',
      framework: 'pytorch',
      status: i === steps.length - 1 ? 'completed' : 'running',
      agent: 'antigravity',
      project: 'myartifact-demo',
      hparams: {
        optimizer: 'AdamW (8-bit)',
        learning_rate: 0.0002,
        batch_size: 32,
        lora_rank: 16,
        lora_alpha: 32,
        warmup_steps: 50,
        precision: 'bf16',
      },
      step: steps[i],
      epoch: Number(((i + 1) * 0.25).toFixed(2)),
      wallTime: baseTime + i * 300,
      metrics: {
        'train/loss': trainLoss[i],
        'val/loss': valLoss[i],
        'val/accuracy': valAcc[i],
        'train/lr': lr[i],
      },
    });
  }

  store.saveModelCheckpoint({
    slug: 'qwen-coder-lora-run',
    name: 'adapter-step-500.safetensors',
    step: 500,
    epoch: 1.25,
    format: 'safetensors',
    metrics: { 'val/loss': 1.02, 'val/accuracy': 0.77 },
    isBest: false,
    agent: 'claude-code',
    summary: 'v2: Saved mid-training LoRA checkpoint at step 500',
  });

  store.saveModelCheckpoint({
    slug: 'qwen-coder-lora-run',
    name: 'best-lora-adapter-step-1000.safetensors',
    step: 1000,
    epoch: 2.5,
    format: 'safetensors',
    metrics: { 'val/loss': 0.61, 'val/accuracy': 0.932 },
    isBest: true,
    agent: 'antigravity',
    summary: 'v3: Saved best LoRA model checkpoint at step 1000 (val/acc 93.2%)',
  });
}

export const SAMPLE_THREEJS_WORKBENCH_TSX = `// @title: Three.js 3D Kinematic & Shader Studio Workbench
// @description: Interactive Three.js + OrbitControls 3D workbench featuring a 3-DOF inverse-kinematics robotic arm, crystal lattice, harmonic terrain mesh, raycast part inspector, and persistent window.storage state.
// @tags: threejs, 3d, webgl, orbitcontrols, kinematics, moss, react
import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Compass,
  Cpu,
  Crosshair,
  Database,
  Grid3x3,
  Layers,
  Moon,
  MousePointerClick,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STORAGE_KEY = 'threejs-workbench:state';

const PALETTES = {
  day: {
    bg: '#F7F4ED',
    surface: '#FCFBF7',
    sunken: '#EFEBE1',
    border: '#E2DDD0',
    ink: '#1E2420',
    muted: '#4A524A',
    accent: '#55684F',
    accentInk: '#F7F4ED',
    accentSoft: '#E4EADF',
    brass: '#C8A96B',
    brassSoft: '#F8F1E3',
    slate: '#7C93A8',
    canvasBg: '#F1ECE0',
    gridMain: '#8FA28A',
    gridSub: '#DBD4C4',
  },
  night: {
    bg: '#151A16',
    surface: '#1D231E',
    sunken: '#111512',
    border: '#2D352E',
    ink: '#ECEAE3',
    muted: '#9AA196',
    accent: '#8FA28A',
    accentInk: '#151A16',
    accentSoft: '#263027',
    brass: '#C8A96B',
    brassSoft: '#2E2A1E',
    slate: '#93A9BD',
    canvasBg: '#101411',
    gridMain: '#55684F',
    gridSub: '#242C25',
  },
} as const;

type SceneMode = 'arm' | 'lattice' | 'terrain';
type ThemeMode = 'day' | 'night';
type CameraPreset = 'iso' | 'front' | 'top' | 'side';

interface PartInspection {
  id: string;
  name: string;
  role: string;
  materialLabel: string;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  triangles: number;
  vertices: number;
}

const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { label: 'Isometric', pos: [4.5, 3.3, 4.9], target: [0, 0.95, 0] },
  front: { label: 'Front', pos: [0, 1.75, 6.2], target: [0, 0.95, 0] },
  top: { label: 'Top', pos: [0.01, 6.9, 0.01], target: [0, 0.85, 0] },
  side: { label: 'Side', pos: [6.1, 1.9, 0.01], target: [0, 0.95, 0] },
};

const SCENE_TABS: Array<{ id: SceneMode; label: string; subtitle: string }> = [
  { id: 'arm', label: '3-DOF Arm', subtitle: 'Analytical IK + 90-pt trail' },
  { id: 'lattice', label: 'Crystal Lattice', subtitle: 'Physical core + 24 instanced nodes' },
  { id: 'terrain', label: 'Terrain Field', subtitle: 'Harmonic vertex displacement' },
];

export default function ThreeJsKinematicWorkbench() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRigRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);
  const applyThemeRef = useRef<(mode: ThemeMode) => void>(() => {});
  const pickPartRef = useRef<(mesh: THREE.Mesh) => void>(() => {});
  const sceneMeshesRef = useRef<THREE.Mesh[]>([]);

  const [sceneMode, setSceneMode] = useState<SceneMode>('arm');
  const [themeMode, setThemeMode] = useState<ThemeMode>('day');
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [reach, setReach] = useState(1.95);
  const [storageReady, setStorageReady] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState({
    fps: 60,
    frameMs: 16.7,
    triangles: 0,
    calls: 0,
    focus: [0, 1.2, 0] as [number, number, number],
  });
  const [selectedPart, setSelectedPart] = useState<PartInspection | null>(null);

  const liveRef = useRef({
    sceneMode: 'arm' as SceneMode,
    themeMode: 'day' as ThemeMode,
    wireframe: false,
    showGrid: true,
    autoOrbit: false,
    paused: false,
    speed: 1.0,
    reach: 1.95,
    selectedId: '',
  });

  useEffect(() => {
    window.storage?.get(STORAGE_KEY).then((res) => {
      if (res?.value) {
        const s = JSON.parse(res.value);
        if (s.sceneMode === 'arm' || s.sceneMode === 'lattice' || s.sceneMode === 'terrain') setSceneMode(s.sceneMode);
        if (s.themeMode === 'day' || s.themeMode === 'night') setThemeMode(s.themeMode);
        if (typeof s.wireframe === 'boolean') setWireframe(s.wireframe);
        if (typeof s.showGrid === 'boolean') setShowGrid(s.showGrid);
        if (typeof s.autoOrbit === 'boolean') setAutoOrbit(s.autoOrbit);
        if (typeof s.speed === 'number') setSpeed(s.speed);
        if (typeof s.reach === 'number') setReach(s.reach);
      }
    }).catch(() => {}).finally(() => setStorageReady(true));
  }, []);

  useEffect(() => {
    liveRef.current = {
      ...liveRef.current,
      sceneMode,
      themeMode,
      wireframe,
      showGrid,
      autoOrbit,
      paused,
      speed,
      reach,
    };
    applyThemeRef.current(themeMode);
    if (!liveRef.current.selectedId.startsWith(sceneMode + '-')) {
      const fallback = sceneMeshesRef.current.find((m) => String(m.userData?.id || '').startsWith(sceneMode + '-'));
      if (fallback) pickPartRef.current(fallback);
    }
    if (storageReady) {
      window.storage?.set(
        STORAGE_KEY,
        JSON.stringify({ sceneMode, themeMode, wireframe, showGrid, autoOrbit, speed, reach })
      ).catch(() => {});
    }
  }, [sceneMode, themeMode, wireframe, showGrid, autoOrbit, paused, speed, reach, storageReady]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'Unable to initialize WebGL context');
      return;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 440);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 120);
    camera.position.set(...CAMERA_PRESETS.iso.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.2;
    controls.maxDistance = 14;
    controls.target.set(...CAMERA_PRESETS.iso.target);
    cameraRigRef.current = { camera, controls };

    const hemiLight = new THREE.HemisphereLight(0xfcfbf7, 0x3b4439, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.65);
    keyLight.position.set(5.5, 8.5, 5.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 24;
    keyLight.shadow.camera.left = -4.5;
    keyLight.shadow.camera.right = 4.5;
    keyLight.shadow.camera.top = 4.5;
    keyLight.shadow.camera.bottom = -4.5;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8fa28a, 0.65);
    rimLight.position.set(-5, 3, -5);
    scene.add(rimLight);

    const helpersGroup = new THREE.Group();
    let gridHelper = new THREE.GridHelper(10, 20, PALETTES.day.gridMain, PALETTES.day.gridSub);
    const axesHelper = new THREE.AxesHelper(1.25);
    axesHelper.position.set(-3.8, 0.02, -3.8);
    helpersGroup.add(gridHelper, axesHelper);
    scene.add(helpersGroup);

    const shadowFloorGeo = new THREE.PlaneGeometry(14, 14);
    const shadowFloorMat = new THREE.ShadowMaterial({ opacity: 0.14 });
    const shadowFloor = new THREE.Mesh(shadowFloorGeo, shadowFloorMat);
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    const disposables: Array<{ dispose: () => void }> = [shadowFloorGeo, shadowFloorMat];
    const wireframeMaterials: Array<{ mat: THREE.Material & { wireframe: boolean }; alwaysWire?: boolean }> = [];
    const inspectableMeshes: THREE.Mesh[] = [];

    const regGeo = <T extends THREE.BufferGeometry,>(g: T): T => {
      disposables.push(g);
      return g;
    };
    const regMat = <T extends THREE.Material,>(m: T, alwaysWire = false): T => {
      disposables.push(m);
      if ('wireframe' in m) {
        wireframeMaterials.push({ mat: m as THREE.Material & { wireframe: boolean }, alwaysWire });
      }
      return m;
    };
    const tagPart = (mesh: THREE.Mesh, id: string, name: string, role: string, materialLabel: string) => {
      mesh.userData = { id, name, role, materialLabel };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      inspectableMeshes.push(mesh);
      return mesh;
    };

    // ------------------------------------------------------------------------
    // Scene 1: 3-DOF Kinematic Robotic Arm (Analytical 2-link + Base Yaw IK)
    // ------------------------------------------------------------------------
    const armGroup = new THREE.Group();
    scene.add(armGroup);

    const matSlate = regMat(new THREE.MeshStandardMaterial({ color: '#39463B', roughness: 0.42, metalness: 0.35 }));
    const matSage = regMat(new THREE.MeshStandardMaterial({ color: '#55684F', roughness: 0.34, metalness: 0.25 }));
    const matSageLight = regMat(new THREE.MeshStandardMaterial({ color: '#8FA28A', roughness: 0.3, metalness: 0.2 }));
    const matBrass = regMat(new THREE.MeshStandardMaterial({ color: '#C8A96B', roughness: 0.22, metalness: 0.72 }));
    const matBeacon = regMat(new THREE.MeshStandardMaterial({ color: '#C8A96B', emissive: '#C8A96B', emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.5 }));

    const basePedestal = tagPart(
      new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.68, 0.82, 0.24, 32)), matSlate),
      'arm-pedestal',
      'Base Pedestal',
      'Fixed 6-bolt workcell plinth anchoring the kinematic origin',
      'Anodized Moss Slate'
    );
    basePedestal.position.y = 0.12;
    armGroup.add(basePedestal);

    const yawGroup = new THREE.Group();
    armGroup.add(yawGroup);

    const turretMesh = tagPart(
      new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.36, 0.44, 0.32, 24)), matSage),
      'arm-turret',
      'J1 Yaw Turret',
      '360-deg azimuth rotary stage aligned via atan2(tx, tz)',
      'Powder-Coated Sage'
    );
    turretMesh.position.y = 0.4;
    yawGroup.add(turretMesh);

    const H_SHOULDER = 0.56;
    const L1 = 1.65;
    const L2 = 1.45;
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(0, H_SHOULDER, 0);
    yawGroup.add(shoulderPivot);

    const shoulderHub = tagPart(
      new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.22, 24, 16)), matBrass),
      'arm-shoulder-joint',
      'J2 Shoulder Servo',
      'High-torque pitch actuator driven by analytical law-of-cosines IK',
      'Machined Brass'
    );
    shoulderPivot.add(shoulderHub);

    const upperLink = tagPart(
      new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.22, L1, 0.22)), matSageLight),
      'arm-upper-link',
      'Upper Arm Link (L1 = 1.65m)',
      'Primary structural boom connecting shoulder J2 to elbow J3',
      'Brushed Sage Alloy'
    );
    upperLink.position.y = L1 / 2;
    shoulderPivot.add(upperLink);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, L1, 0);
    shoulderPivot.add(elbowPivot);

    const elbowHub = tagPart(
      new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.18, 20, 16)), matBrass),
      'arm-elbow-joint',
      'J3 Elbow Servo',
      'Elbow-up flexion joint maintaining clearance above the ground plane',
      'Machined Brass'
    );
    elbowPivot.add(elbowHub);

    const forearmLink = tagPart(
      new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.16, L2, 0.16)), matSage),
      'arm-forearm-link',
      'Forearm Link (L2 = 1.45m)',
      'Secondary reach link carrying the wrist gripper payload',
      'Powder-Coated Sage'
    );
    forearmLink.position.y = L2 / 2;
    elbowPivot.add(forearmLink);

    const wristPivot = new THREE.Group();
    wristPivot.position.set(0, L2, 0);
    elbowPivot.add(wristPivot);

    const gripperTip = tagPart(
      new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.14, 0.34, 16)), matBrass),
      'arm-end-effector',
      'End-Effector Tool',
      'Tracked TCP tip tracing the 3D Lissajous target trajectory',
      'Machined Brass'
    );
    gripperTip.position.y = 0.17;
    wristPivot.add(gripperTip);

    const targetBeacon = tagPart(
      new THREE.Mesh(regGeo(new THREE.OctahedronGeometry(0.16, 1)), matBeacon),
      'arm-target-beacon',
      'Target Waypoint Beacon',
      'Closed-form IK target oscillating along a 3D figure-8 path',
      'Emissive Brass'
    );
    armGroup.add(targetBeacon);

    const TRAIL_COUNT = 90;
    const trailPositions = new Float32Array(TRAIL_COUNT * 3);
    const trailGeo = regGeo(new THREE.BufferGeometry());
    const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
    trailGeo.setAttribute('position', trailPosAttr);
    const trailMat = regMat(new THREE.LineBasicMaterial({ color: '#C8A96B', transparent: true, opacity: 0.78 }));
    const trailLine = new THREE.Line(trailGeo, trailMat);
    armGroup.add(trailLine);

    // ------------------------------------------------------------------------
    // Scene 2: Orbital Crystal Lattice (Physical Core + Instanced Satellites)
    // ------------------------------------------------------------------------
    const latticeGroup = new THREE.Group();
    latticeGroup.visible = false;
    scene.add(latticeGroup);

    const crystalMat = regMat(
      new THREE.MeshPhysicalMaterial({
        color: '#55684F',
        roughness: 0.16,
        metalness: 0.15,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
        flatShading: true,
      })
    );
    const crystalCore = tagPart(
      new THREE.Mesh(regGeo(new THREE.IcosahedronGeometry(0.88, 1)), crystalMat),
      'lattice-core',
      'Geodesic Crystal Core',
      'Clearcoat-shaded icosahedral nucleus with flat-faceted normals',
      'MeshPhysicalMaterial'
    );
    crystalCore.position.y = 1.45;
    latticeGroup.add(crystalCore);

    const innerGeoMesh = tagPart(
      new THREE.Mesh(
        regGeo(new THREE.OctahedronGeometry(1.18, 0)),
        regMat(new THREE.MeshStandardMaterial({ color: '#C8A96B', wireframe: true }), true)
      ),
      'lattice-cage',
      'Harmonic Wireframe Cage',
      'Counter-rotating octahedral reference frame',
      'Wireframe Brass'
    );
    innerGeoMesh.position.y = 1.45;
    latticeGroup.add(innerGeoMesh);

    const ringInner = tagPart(
      new THREE.Mesh(regGeo(new THREE.TorusGeometry(1.65, 0.045, 16, 72)), matBrass),
      'lattice-ring-inner',
      'Inner Gimbal Ring',
      'Precessing orbital plane tilted 58 degrees off horizon',
      'Machined Brass'
    );
    ringInner.position.y = 1.45;
    latticeGroup.add(ringInner);

    const ringOuter = tagPart(
      new THREE.Mesh(regGeo(new THREE.TorusGeometry(2.18, 0.038, 16, 84)), matSageLight),
      'lattice-ring-outer',
      'Outer Gimbal Ring',
      'Stabilizing outer ring tracking counter-phase angular velocity',
      'Brushed Sage Alloy'
    );
    ringOuter.position.y = 1.45;
    latticeGroup.add(ringOuter);

    const SAT_COUNT = 24;
    const satGeo = regGeo(new THREE.OctahedronGeometry(0.11, 0));
    const satMat = regMat(new THREE.MeshStandardMaterial({ color: '#C8A96B', roughness: 0.25, metalness: 0.6 }));
    const satellites = new THREE.InstancedMesh(satGeo, satMat, SAT_COUNT);
    satellites.userData = {
      id: 'lattice-satellites',
      name: '24 Instanced Orbital Nodes',
      role: 'Single-draw-call InstancedMesh arranged on Fibonacci orbital shells',
      materialLabel: 'Instanced Brass',
    };
    satellites.castShadow = true;
    inspectableMeshes.push(satellites);
    latticeGroup.add(satellites);

    // ------------------------------------------------------------------------
    // Scene 3: Harmonic Terrain Mesh (Dynamic Vertex Displacement + Colors)
    // ------------------------------------------------------------------------
    const terrainGroup = new THREE.Group();
    terrainGroup.visible = false;
    scene.add(terrainGroup);

    const terrainGeo = regGeo(new THREE.PlaneGeometry(6.2, 6.2, 52, 52));
    terrainGeo.rotateX(-Math.PI / 2);
    const tPosAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
    const tColors = new Float32Array(tPosAttr.count * 3);
    const tColorAttr = new THREE.BufferAttribute(tColors, 3);
    terrainGeo.setAttribute('color', tColorAttr);

    const terrainMat = regMat(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.58,
        metalness: 0.08,
        flatShading: true,
      })
    );
    const terrainMesh = tagPart(
      new THREE.Mesh(terrainGeo, terrainMat),
      'terrain-surface',
      'Harmonic Elevation Surface',
      '52x52 subdivided mesh updated dynamically via two-wave harmonic interference',
      'Vertex-Colored Standard'
    );
    terrainMesh.position.y = 0.95;
    terrainGroup.add(terrainMesh);

    const terrainWireMat = regMat(
      new THREE.MeshBasicMaterial({ color: '#C8A96B', wireframe: true, transparent: true, opacity: 0.22 }),
      true
    );
    const terrainWire = new THREE.Mesh(terrainGeo, terrainWireMat);
    terrainWire.position.y = 0.953;
    terrainGroup.add(terrainWire);

    const probeMarker = tagPart(
      new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.15, 20, 16)), matBeacon),
      'terrain-probe',
      'Surface Crest Probe',
      'Buoy riding live terrain elevation at sample coordinate (0.9, y, -0.6)',
      'Emissive Brass'
    );
    terrainGroup.add(probeMarker);

    sceneMeshesRef.current = inspectableMeshes;

    const inspectMesh = (mesh: THREE.Mesh) => {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      mesh.getWorldPosition(worldPos);
      mesh.getWorldQuaternion(worldQuat);
      const euler = new THREE.Euler().setFromQuaternion(worldQuat);
      const geo = mesh.geometry;
      const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      const meta = mesh.userData || {};
      liveRef.current.selectedId = String(meta.id || '');
      setSelectedPart({
        id: String(meta.id || 'mesh'),
        name: String(meta.name || 'Scene Mesh'),
        role: String(meta.role || 'Procedural Three.js geometry'),
        materialLabel: String(meta.materialLabel || 'MeshStandardMaterial'),
        position: [Number(worldPos.x.toFixed(2)), Number(worldPos.y.toFixed(2)), Number(worldPos.z.toFixed(2))],
        rotationDeg: [
          Math.round(THREE.MathUtils.radToDeg(euler.x)),
          Math.round(THREE.MathUtils.radToDeg(euler.y)),
          Math.round(THREE.MathUtils.radToDeg(euler.z)),
        ],
        triangles: Math.round(triCount),
        vertices: geo.attributes.position.count,
      });
    };
    pickPartRef.current = inspectMesh;
    inspectMesh(armGroup.children[0] as THREE.Mesh);

    applyThemeRef.current = (mode: ThemeMode) => {
      const p = PALETTES[mode];
      scene.background = new THREE.Color(p.canvasBg);
      helpersGroup.remove(gridHelper);
      gridHelper.dispose();
      gridHelper = new THREE.GridHelper(10, 20, p.gridMain, p.gridSub);
      helpersGroup.add(gridHelper);
      shadowFloorMat.opacity = mode === 'day' ? 0.14 : 0.35;
    };
    applyThemeRef.current(liveRef.current.themeMode);

    // Raycast click handler (ignores camera orbit drags > 6px)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPt = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      downPt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const activeRoot =
        liveRef.current.sceneMode === 'arm'
          ? armGroup
          : liveRef.current.sceneMode === 'lattice'
          ? latticeGroup
          : terrainGroup;
      const hits = raycaster.intersectObjects(activeRoot.children, true);
      const hitMesh = hits.find((h) => h.object instanceof THREE.Mesh && h.object.userData?.id);
      if (hitMesh && hitMesh.object instanceof THREE.Mesh) {
        inspectMesh(hitMesh.object);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const ro = new ResizeObserver(() => {
      const nw = Math.max(container.clientWidth, 320);
      const nh = Math.max(container.clientHeight, 440);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(container);

    const dummy = new THREE.Object3D();
    const eeWorld = new THREE.Vector3();
    const cLow = new THREE.Color('#344532');
    const cMid = new THREE.Color('#55684F');
    const cHigh = new THREE.Color('#8FA28A');
    const cPeak = new THREE.Color('#C8A96B');
    const cTmp = new THREE.Color();

    let raf = 0;
    let simTime = 0;
    let lastNow = performance.now();
    let frameCount = 0;
    let fpsWindowStart = lastNow;
    let frameMsAccum = 0;
    let trailWriteCounter = 0;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const rawDt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      const st = liveRef.current;
      if (!st.paused) {
        simTime += rawDt * st.speed;
      }

      helpersGroup.visible = st.showGrid;
      controls.autoRotate = st.autoOrbit;
      controls.autoRotateSpeed = 1.5;

      for (const item of wireframeMaterials) {
        item.mat.wireframe = item.alwaysWire ? true : st.wireframe;
      }

      armGroup.visible = st.sceneMode === 'arm';
      latticeGroup.visible = st.sceneMode === 'lattice';
      terrainGroup.visible = st.sceneMode === 'terrain';

      let focusPoint: [number, number, number] = [0, 1.2, 0];

      if (st.sceneMode === 'arm') {
        const tx = st.reach * Math.cos(simTime * 0.85);
        const tz = st.reach * 0.82 * Math.sin(simTime * 0.85);
        const ty = 1.25 + 0.55 * Math.sin(simTime * 1.7);
        targetBeacon.position.set(tx, ty, tz);
        targetBeacon.rotation.y = simTime * 1.4;

        const yaw = Math.atan2(tx, tz);
        const dr = Math.hypot(tx, tz);
        const dy = ty - H_SHOULDER;
        const dist = Math.min(L1 + L2 - 0.04, Math.max(Math.abs(L1 - L2) + 0.06, Math.hypot(dr, dy)));
        const phi = Math.atan2(dr, dy);
        const cosQ2 = THREE.MathUtils.clamp((dist * dist - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
        const q2 = Math.acos(cosQ2);
        const alpha = Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
        const q1 = phi - alpha;

        yawGroup.rotation.y = yaw;
        shoulderPivot.rotation.x = q1;
        elbowPivot.rotation.x = q2;
        wristPivot.rotation.x = -(q1 + q2) + Math.PI * 0.5;

        wristPivot.getWorldPosition(eeWorld);
        focusPoint = [Number(eeWorld.x.toFixed(2)), Number(eeWorld.y.toFixed(2)), Number(eeWorld.z.toFixed(2))];

        if (!st.paused && trailWriteCounter % 2 === 0) {
          if (trailWriteCounter === 0) {
            for (let i = 0; i < TRAIL_COUNT; i++) {
              trailPositions[i * 3] = eeWorld.x;
              trailPositions[i * 3 + 1] = eeWorld.y;
              trailPositions[i * 3 + 2] = eeWorld.z;
            }
          } else {
            for (let i = TRAIL_COUNT - 1; i > 0; i--) {
              trailPositions[i * 3] = trailPositions[(i - 1) * 3];
              trailPositions[i * 3 + 1] = trailPositions[(i - 1) * 3 + 1];
              trailPositions[i * 3 + 2] = trailPositions[(i - 1) * 3 + 2];
            }
            trailPositions[0] = eeWorld.x;
            trailPositions[1] = eeWorld.y;
            trailPositions[2] = eeWorld.z;
          }
          trailPosAttr.needsUpdate = true;
        }
        trailWriteCounter++;
      } else if (st.sceneMode === 'lattice') {
        crystalCore.rotation.y = simTime * 0.65;
        crystalCore.rotation.x = Math.sin(simTime * 0.4) * 0.25;
        innerGeoMesh.rotation.y = -simTime * 0.45;
        ringInner.rotation.x = Math.PI / 3 + Math.sin(simTime * 0.5) * 0.22;
        ringInner.rotation.z = simTime * 0.42;
        ringOuter.rotation.x = -Math.PI / 4;
        ringOuter.rotation.y = -simTime * 0.35;

        for (let i = 0; i < SAT_COUNT; i++) {
          const theta = (i / SAT_COUNT) * Math.PI * 2 + simTime * (0.45 + (i % 3) * 0.12);
          const radius = i % 2 === 0 ? 1.65 : 2.18;
          const elev = Math.sin(theta * 2 + i) * 0.45;
          dummy.position.set(Math.cos(theta) * radius, 1.45 + elev, Math.sin(theta) * radius);
          dummy.rotation.set(simTime + i, simTime * 0.7, 0);
          dummy.updateMatrix();
          satellites.setMatrixAt(i, dummy.matrix);
        }
        satellites.instanceMatrix.needsUpdate = true;
        focusPoint = [0, 1.45, 0];
      } else {
        for (let i = 0; i < tPosAttr.count; i++) {
          const vx = tPosAttr.getX(i);
          const vz = tPosAttr.getZ(i);
          const h =
            0.48 * Math.sin(vx * 0.95 + simTime * 1.1) * Math.cos(vz * 0.85 - simTime * 0.75) +
            0.26 * Math.cos(Math.hypot(vx, vz) * 1.45 - simTime * 1.45);
          tPosAttr.setY(i, h);
          const norm = THREE.MathUtils.clamp((h + 0.75) / 1.5, 0, 1);
          if (norm < 0.35) {
            cTmp.lerpColors(cLow, cMid, norm / 0.35);
          } else if (norm < 0.72) {
            cTmp.lerpColors(cMid, cHigh, (norm - 0.35) / 0.37);
          } else {
            cTmp.lerpColors(cHigh, cPeak, (norm - 0.72) / 0.28);
          }
          tColors[i * 3] = cTmp.r;
          tColors[i * 3 + 1] = cTmp.g;
          tColors[i * 3 + 2] = cTmp.b;
        }
        tPosAttr.needsUpdate = true;
        tColorAttr.needsUpdate = true;
        terrainGeo.computeVertexNormals();

        const px = 0.9;
        const pz = -0.6;
        const py =
          0.95 +
          0.48 * Math.sin(px * 0.95 + simTime * 1.1) * Math.cos(pz * 0.85 - simTime * 0.75) +
          0.26 * Math.cos(Math.hypot(px, pz) * 1.45 - simTime * 1.45) +
          0.16;
        probeMarker.position.set(px, py, pz);
        focusPoint = [px, Number(py.toFixed(2)), pz];
      }

      controls.update();
      const tRenderStart = performance.now();
      renderer.render(scene, camera);
      frameMsAccum += performance.now() - tRenderStart;
      frameCount++;

      if (now - fpsWindowStart >= 450) {
        const elapsed = now - fpsWindowStart;
        setTelemetry({
          fps: Math.max(1, Math.round((frameCount * 1000) / elapsed)),
          frameMs: Number((frameMsAccum / frameCount || 0.4).toFixed(2)),
          triangles: renderer.info.render.triangles,
          calls: renderer.info.render.calls,
          focus: focusPoint,
        });
        frameCount = 0;
        frameMsAccum = 0;
        fpsWindowStart = now;
      }
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      gridHelper.dispose();
      axesHelper.dispose();
      for (const d of disposables) {
        d.dispose();
      }
      renderer.dispose();
    };
  }, []);

  const pal = PALETTES[themeMode];

  const applyCameraPreset = (presetKey: CameraPreset) => {
    const rig = cameraRigRef.current;
    if (!rig) return;
    const p = CAMERA_PRESETS[presetKey];
    rig.camera.position.set(...p.pos);
    rig.controls.target.set(...p.target);
    rig.controls.update();
  };

  const resetAll = () => {
    setSceneMode('arm');
    setWireframe(false);
    setShowGrid(true);
    setAutoOrbit(false);
    setPaused(false);
    setSpeed(1.0);
    setReach(1.95);
    applyCameraPreset('iso');
  };

  return (
    <div style={{ background: pal.bg, color: pal.ink, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }} className="min-h-screen p-4 md:p-7">
      <div className="max-w-6xl mx-auto space-y-4">
        <header style={{ borderColor: pal.border }} className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div style={{ background: pal.accentSoft, color: pal.accent }} className="h-10 w-10 rounded-xl grid place-items-center shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div style={{ color: pal.muted }} className="text-[11px] uppercase tracking-wider font-mono">
                Three.js 0.170 · WebGL Sandbox · OrbitControls + Raycaster
              </div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                3D Kinematic &amp; Shader Studio Workbench
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ background: pal.accentSoft, color: pal.accent }} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono">
              <Database className="w-3.5 h-3.5" />
              {storageReady ? 'window.storage synced' : 'loading state'}
            </span>
            <button
              type="button"
              onClick={() => setThemeMode((m) => (m === 'day' ? 'night' : 'day'))}
              style={{ background: pal.surface, borderColor: pal.border, color: pal.ink }}
              className="h-8 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              {themeMode === 'day' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              {themeMode === 'day' ? 'Moss Night' : 'Moss Day'}
            </button>
          </div>
        </header>

        {/* Top KPI Telemetry Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-3.5">
            <div style={{ color: pal.muted }} className="text-xs flex items-center justify-between">
              <span>Viewport Frame Rate</span>
              <Cpu className="w-3.5 h-3.5" />
            </div>
            <div className="mt-1 text-xl font-semibold font-mono">{telemetry.fps} FPS</div>
            <div style={{ color: pal.muted }} className="text-[11px] font-mono mt-0.5">CPU render: {telemetry.frameMs} ms</div>
          </div>

          <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-3.5">
            <div style={{ color: pal.muted }} className="text-xs flex items-center justify-between">
              <span>Active Geometry</span>
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div className="mt-1 text-xl font-semibold font-mono">{telemetry.triangles.toLocaleString()} tris</div>
            <div style={{ color: pal.muted }} className="text-[11px] font-mono mt-0.5">{telemetry.calls} WebGL draw calls</div>
          </div>

          <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-3.5">
            <div style={{ color: pal.muted }} className="text-xs flex items-center justify-between">
              <span>{sceneMode === 'arm' ? 'TCP End-Effector' : sceneMode === 'terrain' ? 'Crest Probe' : 'Lattice Origin'}</span>
              <Crosshair className="w-3.5 h-3.5" />
            </div>
            <div className="mt-1 text-sm md:text-base font-semibold font-mono">
              ({telemetry.focus[0].toFixed(2)}, {telemetry.focus[1].toFixed(2)}, {telemetry.focus[2].toFixed(2)})
            </div>
            <div style={{ color: pal.muted }} className="text-[11px] font-mono mt-1">world meters (X, Y, Z)</div>
          </div>

          <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-3.5">
            <div style={{ color: pal.muted }} className="text-xs flex items-center justify-between">
              <span>Selected Part</span>
              <MousePointerClick className="w-3.5 h-3.5" />
            </div>
            <div className="mt-1 text-sm font-semibold truncate">{selectedPart ? selectedPart.name : 'Click any 3D mesh'}</div>
            <div style={{ color: pal.accent }} className="text-[11px] font-mono mt-1 truncate">
              {selectedPart ? \`\${selectedPart.triangles} tris · \${selectedPart.materialLabel}\` : 'Raycaster ready'}
            </div>
          </div>
        </section>

        {/* Controls Bar */}
        <section style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {SCENE_TABS.map((tab) => {
              const active = sceneMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSceneMode(tab.id)}
                  style={{
                    background: active ? pal.accent : pal.sunken,
                    color: active ? pal.accentInk : pal.ink,
                    borderColor: active ? pal.accent : pal.border,
                  }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition"
                  title={tab.subtitle}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              style={{ background: pal.sunken, borderColor: pal.border, color: pal.ink }}
              className="h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setWireframe((w) => !w)}
              style={{
                background: wireframe ? pal.accentSoft : pal.sunken,
                borderColor: wireframe ? pal.accent : pal.border,
                color: wireframe ? pal.accent : pal.ink,
              }}
              className="h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <Grid3x3 className="w-3.5 h-3.5" />
              Wireframe
            </button>
            <button
              type="button"
              onClick={() => setShowGrid((g) => !g)}
              style={{
                background: showGrid ? pal.accentSoft : pal.sunken,
                borderColor: showGrid ? pal.accent : pal.border,
                color: showGrid ? pal.accent : pal.ink,
              }}
              className="h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5" />
              Grid &amp; Axes
            </button>
            <button
              type="button"
              onClick={() => setAutoOrbit((a) => !a)}
              style={{
                background: autoOrbit ? pal.brassSoft : pal.sunken,
                borderColor: autoOrbit ? pal.brass : pal.border,
                color: pal.ink,
              }}
              className="h-8 px-2.5 rounded-lg border text-xs font-medium cursor-pointer"
            >
              Auto-Orbit
            </button>
            <button
              type="button"
              onClick={resetAll}
              style={{ background: pal.sunken, borderColor: pal.border, color: pal.ink }}
              className="h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </section>

        {/* Main 3D Stage + Inspector */}
        <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div style={{ background: pal.surface, borderColor: pal.border }} className="lg:col-span-3 rounded-xl border overflow-hidden flex flex-col">
            <div style={{ borderColor: pal.border, background: pal.sunken }} className="px-3.5 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs">
              <span style={{ color: pal.muted }}>
                Left-drag: Orbit · Scroll: Zoom · Right-drag: Pan · Click mesh: Inspect
              </span>
              <div className="flex items-center gap-1">
                {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyCameraPreset(key)}
                    style={{ background: pal.surface, borderColor: pal.border, color: pal.ink }}
                    className="px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer"
                  >
                    {CAMERA_PRESETS[key].label}
                  </button>
                ))}
              </div>
            </div>

            {webglError ? (
              <div className="h-[460px] grid place-items-center p-6 text-center">
                <div>
                  <p className="font-semibold text-sm">WebGL context unavailable in this browser</p>
                  <p style={{ color: pal.muted }} className="text-xs mt-1 font-mono">{webglError}</p>
                </div>
              </div>
            ) : (
              <div ref={mountRef} className="w-full h-[460px]" />
            )}
          </div>

          {/* Right Panel: Parameters + Raycast Part Inspector */}
          <aside className="space-y-4">
            <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider font-mono" style={{ color: pal.muted }}>
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Simulation Tuning
              </div>
              <label className="block space-y-1 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: pal.muted }}>Playback Speed</span>
                  <span className="font-mono font-medium">{speed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="2.5"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  style={{ accentColor: pal.accent }}
                  className="w-full"
                />
              </label>
              {sceneMode === 'arm' && (
                <label className="block space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color: pal.muted }}>IK Orbit Radius</span>
                    <span className="font-mono font-medium">{reach.toFixed(2)} m</span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="2.55"
                    step="0.05"
                    value={reach}
                    onChange={(e) => setReach(Number(e.target.value))}
                    style={{ accentColor: pal.brass }}
                    className="w-full"
                  />
                </label>
              )}
            </div>

            <div style={{ background: pal.surface, borderColor: pal.border }} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider font-mono" style={{ color: pal.muted }}>
                <MousePointerClick className="w-3.5 h-3.5" />
                Raycast Inspector
              </div>
              {selectedPart ? (
                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-sm">{selectedPart.name}</div>
                    <div style={{ color: pal.muted }} className="font-mono text-[11px]">{selectedPart.id}</div>
                  </div>
                  <p style={{ color: pal.muted }} className="leading-relaxed">{selectedPart.role}</p>
                  <div style={{ background: pal.sunken }} className="rounded-lg p-2.5 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span style={{ color: pal.muted }}>World Pos</span>
                      <span>({selectedPart.position.join(', ')})</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: pal.muted }}>Euler Deg</span>
                      <span>({selectedPart.rotationDeg.join('°, ')}°)</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: pal.muted }}>Geometry</span>
                      <span>{selectedPart.triangles} tris / {selectedPart.vertices} vtx</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: pal.muted }}>Material</span>
                      <span>{selectedPart.materialLabel}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ color: pal.muted }} className="text-xs">Click any part in the 3D viewport to inspect its world transform and geometry stats.</p>
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
`;

export function seedThreeJsDemoArtifact(store: ArtifactStore): void {
  store.upsertBySlug('threejs-kinematic-workbench', {
    title: 'Three.js 3D Kinematic & Shader Studio Workbench',
    description:
      'Interactive Three.js + OrbitControls 3D workbench featuring a 3-DOF inverse-kinematics robotic arm, crystal lattice, harmonic terrain mesh, raycast part inspector, and persistent window.storage state.',
    type: 'react',
    language: 'tsx',
    content: SAMPLE_THREEJS_WORKBENCH_TSX,
    agent: 'antigravity',
    project: 'myartifact-demo',
    category: 'concepts/architecture',
    icon: 'scene-3d',
    tags: ['threejs', '3d', 'webgl', 'orbitcontrols', 'kinematics', 'moss', 'react'],
    summary: 'v1: Initial Three.js + OrbitControls 3D showcase workbench',
  });
}
