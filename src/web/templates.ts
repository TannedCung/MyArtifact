import type { ArtifactType } from '../core/types.js';

export interface KitTheme {
  id: string;
  label: string;
  mode: 'light' | 'dark';
  use: string;
  bg: string;
  surface: string;
  sunken: string;
  border: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  highlight: string;
  highlightSoft: string;
  danger: string;
  chart: string[];
  fontSans: string;
  fontDisplay: string;
  fontMono: string;
}

export interface KitTemplate {
  id: 'blank' | 'dashboard' | 'scene-3d' | 'report' | 'diagram' | 'tool' | 'training';
  label: string;
  type: ArtifactType | 'any';
  use: string;
  content: string;
}

export const KIT_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const KIT_THEMES: Record<string, KitTheme> = {
  moss: {
    id: 'moss',
    label: 'Moss',
    mode: 'light',
    use: 'Default. Dashboards, tools, anything you will look at daily.',
    bg: '#F7F4ED',
    surface: '#FCFBF7',
    sunken: '#EFEBE1',
    border: '#E2DDD0',
    ink: '#1E2420',
    muted: '#4A524A',
    accent: '#55684F',
    accentInk: '#F7F4ED',
    accentSoft: '#E4EADF',
    highlight: '#C8A96B',
    highlightSoft: '#F8F1E3',
    danger: '#B4553F',
    chart: ['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A'],
    fontSans: "'IBM Plex Sans', system-ui, sans-serif",
    fontDisplay: "'IBM Plex Sans', system-ui, sans-serif",
    fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  'moss-night': {
    id: 'moss-night',
    label: 'Moss Night',
    mode: 'dark',
    use: 'Dense monitoring views, code-heavy tools, low-light work.',
    bg: '#151A16',
    surface: '#1D231E',
    sunken: '#111512',
    border: '#2D352E',
    ink: '#ECEAE3',
    muted: '#A7AEA2',
    accent: '#8FA28A',
    accentInk: '#151A16',
    accentSoft: '#263027',
    highlight: '#C8A96B',
    highlightSoft: '#2E2A1E',
    danger: '#D98068',
    chart: ['#8FA28A', '#C8A96B', '#93A9BD', '#C99A82', '#C7D3C0'],
    fontSans: "'IBM Plex Sans', system-ui, sans-serif",
    fontDisplay: "'IBM Plex Sans', system-ui, sans-serif",
    fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  ledger: {
    id: 'ledger',
    label: 'Ledger',
    mode: 'light',
    use: 'Reports, memos, write-ups meant to be read top to bottom.',
    bg: '#FBF8F1',
    surface: '#FFFFFF',
    sunken: '#F3EDE0',
    border: '#E6DCC8',
    ink: '#2A2110',
    muted: '#5E5440',
    accent: '#735C2B',
    accentInk: '#FFFFFF',
    accentSoft: '#F4EAD5',
    highlight: '#55684F',
    highlightSoft: '#E4EADF',
    danger: '#A2452F',
    chart: ['#8E733D', '#55684F', '#C8A96B', '#7C93A8', '#B8876F'],
    fontSans: "'IBM Plex Sans', system-ui, sans-serif",
    fontDisplay: "'IBM Plex Serif', Georgia, serif",
    fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  lichen: {
    id: 'lichen',
    label: 'Lichen',
    mode: 'light',
    use: 'Diagrams and overviews shown to others; softer, higher-key.',
    bg: '#E9EFE5',
    surface: '#FBFCF9',
    sunken: '#DEE6D9',
    border: '#C7D3C0',
    ink: '#1A231B',
    muted: '#455045',
    accent: '#435340',
    accentInk: '#F7F4ED',
    accentSoft: '#D5DFCF',
    highlight: '#C8A96B',
    highlightSoft: '#F1E7D2',
    danger: '#A9503B',
    chart: ['#435340', '#C8A96B', '#8FA28A', '#7C93A8', '#B8876F'],
    fontSans: "'IBM Plex Sans', system-ui, sans-serif",
    fontDisplay: "'IBM Plex Sans', system-ui, sans-serif",
    fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  },
};

const DASHBOARD_TSX = `// @title: Weekly Metrics Dashboard
// @description: KPI row, one trend chart and a persistent notes panel
// @tags: template:dashboard, theme:moss
import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Plus, Check, Trash2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/* theme:start */
const THEME = { name: 'moss', grid: '#E2DDD0', axis: '#4A524A', surface: '#FCFBF7', chart: ['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A'] };
const THEME_CSS = \`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}\`;
/* theme:end */

const BASE_CSS = \`body{margin:0;background:var(--ma-bg);color:var(--ma-ink);font-family:var(--ma-font-sans);-webkit-font-smoothing:antialiased}\`;

const SERIES = [
  { label: 'Mon', value: 14200 },
  { label: 'Tue', value: 21500 },
  { label: 'Wed', value: 18900 },
  { label: 'Thu', value: 32400 },
  { label: 'Fri', value: 28100 },
  { label: 'Sat', value: 35900 },
  { label: 'Sun', value: 41200 },
];
const KPIS = [
  { label: 'Tokens this week', value: '192.2k', delta: 18.4 },
  { label: 'Artifacts created', value: '52', delta: 9.1 },
  { label: 'Median TTFT', value: '0.62s', delta: -4.2 },
];
const STORAGE_KEY = 'dashboard:notes';

export default function Dashboard() {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    window.storage?.get(STORAGE_KEY).then((r) => r && setNotes(JSON.parse(r.value))).catch(() => {});
  }, []);
  const save = (next) => {
    setNotes(next);
    window.storage?.set(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <div className="min-h-screen p-6 md:p-10">
      <style>{THEME_CSS + BASE_CSS}</style>
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-[var(--ma-border)]">
          <div>
            <p className="text-[11px] uppercase tracking-[.08em] text-[var(--ma-muted)]" style={{ fontFamily: 'var(--ma-font-mono)' }}>Week 43 · 2026</p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight" style={{ fontFamily: 'var(--ma-font-display)' }}>Weekly metrics</h1>
          </div>
          <span className="text-xs text-[var(--ma-muted)]">Updated just now</span>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-[10px] bg-[var(--ma-surface)] border border-[var(--ma-border)] p-4">
              <div className="text-[13px] text-[var(--ma-muted)]">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold" style={{ fontFamily: 'var(--ma-font-mono)' }}>{k.value}</div>
              <div className={\`mt-2 inline-flex items-center gap-1 text-xs font-medium \${k.delta >= 0 ? 'text-[var(--ma-accent)]' : 'text-[var(--ma-danger)]'}\`}>
                {k.delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {Math.abs(k.delta)}% vs last week
              </div>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 rounded-[10px] bg-[var(--ma-surface)] border border-[var(--ma-border)] p-5">
            <h2 className="text-sm font-semibold mb-4">Token volume</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={SERIES} margin={{ left: -12, right: 8, top: 4 }}>
                  <CartesianGrid stroke={THEME.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={THEME.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={THEME.axis} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: THEME.surface, border: \`1px solid \${THEME.grid}\`, borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke={THEME.chart[0]} strokeWidth={2} fill={THEME.chart[0]} fillOpacity={0.14} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[10px] bg-[var(--ma-surface)] border border-[var(--ma-border)] p-5 flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!draft.trim()) return; save([...notes, { id: Date.now(), text: draft.trim(), done: false }]); setDraft(''); }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note" aria-label="New note"
                className="flex-1 min-w-0 h-8 px-2.5 rounded-md bg-[var(--ma-bg)] border border-[var(--ma-border)] text-[13px] outline-none focus:border-[var(--ma-accent)]" />
              <button aria-label="Add note" className="h-8 w-8 grid place-items-center rounded-md bg-[var(--ma-accent)] text-[var(--ma-accent-ink)]"><Plus size={16} /></button>
            </form>
            {notes.length === 0 && <p className="text-[13px] text-[var(--ma-muted)]">Notes are saved with window.storage and survive reloads.</p>}
            {notes.map((n) => (
              <div key={n.id} className="flex items-center gap-2 text-[13px] p-2 rounded-md bg-[var(--ma-sunken)]">
                <button aria-label="Toggle done" onClick={() => save(notes.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)))}
                  className={\`h-4 w-4 grid place-items-center rounded border \${n.done ? 'bg-[var(--ma-accent)] border-[var(--ma-accent)] text-[var(--ma-accent-ink)]' : 'border-[var(--ma-muted)]'}\`}>
                  {n.done && <Check size={12} />}
                </button>
                <span className={\`flex-1 \${n.done ? 'line-through text-[var(--ma-muted)]' : ''}\`}>{n.text}</span>
                <button aria-label="Delete note" onClick={() => save(notes.filter((x) => x.id !== n.id))} className="text-[var(--ma-muted)] hover:text-[var(--ma-danger)]"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
`;

const SCENE_3D_TSX = `// @title: Interactive Three.js 3D Viewport
// @description: OrbitControls Three.js scene with live FPS/triangle telemetry and persistent window.storage preferences
// @tags: template:scene-3d, theme:moss, threejs, 3d
import React, { useEffect, useRef, useState } from 'react';
import { Box, RotateCcw, Grid3x3, Sparkles } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* theme:start */
const THEME = { name: 'moss', grid: '#E2DDD0', axis: '#4A524A', surface: '#FCFBF7', chart: ['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A'] };
const THEME_CSS = \`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}\`;
/* theme:end */

const BASE_CSS = \`body{margin:0;background:var(--ma-bg);color:var(--ma-ink);font-family:var(--ma-font-sans);-webkit-font-smoothing:antialiased}\`;
const STORAGE_KEY = 'scene3d:prefs';

export default function Scene3DStarter() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [wireframe, setWireframe] = useState(false);
  const [stats, setStats] = useState({ fps: 60, triangles: 0 });
  const [webglError, setWebglError] = useState<string | null>(null);
  const optsRef = useRef({ speed: 1.0, wireframe: false });

  useEffect(() => {
    optsRef.current = { speed, wireframe };
    window.storage?.set(STORAGE_KEY, JSON.stringify({ speed, wireframe })).catch(() => {});
  }, [speed, wireframe]);

  useEffect(() => {
    window.storage?.get(STORAGE_KEY).then((r) => {
      if (!r?.value) return;
      const saved = JSON.parse(r.value);
      if (typeof saved.speed === 'number') setSpeed(saved.speed);
      if (typeof saved.wireframe === 'boolean') setWireframe(saved.wireframe);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL unavailable');
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(THEME.surface);
    const w = Math.max(el.clientWidth, 320);
    const h = Math.max(el.clientHeight, 420);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(4.2, 3.1, 4.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.8, 0);
    ctrlRef.current = { camera, controls };

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const keyLight = new THREE.DirectionalLight(0xfff8eb, 1.45);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(10, 14, THEME.axis, THEME.grid);
    scene.add(grid);

    const coreGeo = new THREE.IcosahedronGeometry(0.95, 1);
    const coreMat = new THREE.MeshStandardMaterial({ color: THEME.chart[0], roughness: 0.32, metalness: 0.25, flatShading: true });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 1.05;
    scene.add(core);

    const ringGeo = new THREE.TorusGeometry(1.55, 0.08, 16, 64);
    const ringMat = new THREE.MeshStandardMaterial({ color: THEME.chart[1], roughness: 0.25, metalness: 0.55 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 1.05;
    scene.add(ring);

    const ro = new ResizeObserver(() => {
      const nw = Math.max(el.clientWidth, 320);
      const nh = Math.max(el.clientHeight, 420);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(el);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsClock = last;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { speed: sp, wireframe: wf } = optsRef.current;
      coreMat.wireframe = wf;
      ringMat.wireframe = wf;
      core.rotation.y += dt * 0.7 * sp;
      core.rotation.x += dt * 0.3 * sp;
      ring.rotation.x = Math.PI / 3 + Math.sin(now * 0.001 * sp) * 0.25;
      ring.rotation.z -= dt * 0.55 * sp;
      controls.update();
      renderer.render(scene, camera);

      frames++;
      if (now - fpsClock >= 500) {
        setStats({ fps: Math.round((frames * 1000) / (now - fpsClock)), triangles: renderer.info.render.triangles });
        frames = 0;
        fpsClock = now;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      renderer.dispose();
    };
  }, []);

  const resetCam = () => {
    if (!ctrlRef.current) return;
    ctrlRef.current.camera.position.set(4.2, 3.1, 4.8);
    ctrlRef.current.controls.target.set(0, 0.8, 0);
    ctrlRef.current.controls.update();
  };

  return (
    <div className="min-h-screen p-6 md:p-8">
      <style>{THEME_CSS + BASE_CSS}</style>
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--ma-border)]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-[var(--ma-accent-soft)] text-[var(--ma-accent)] grid place-items-center"><Box size={18} /></div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight" style={{ fontFamily: 'var(--ma-font-display)' }}>Interactive Three.js 3D Scene</h1>
              <p className="text-xs text-[var(--ma-muted)]">Drag to orbit · Scroll to zoom · Right-drag to pan</p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-2.5 py-1 rounded-full bg-[var(--ma-sunken)] border border-[var(--ma-border)]">{stats.fps} FPS</span>
            <span className="px-2.5 py-1 rounded-full bg-[var(--ma-accent-soft)] text-[var(--ma-accent)]">{stats.triangles.toLocaleString()} tris</span>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-[var(--ma-surface)] border border-[var(--ma-border)] px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-[var(--ma-muted)]">
            <Sparkles size={14} className="text-[var(--ma-accent)]" />
            Speed <span className="font-mono text-[var(--ma-ink)]">{speed.toFixed(1)}x</span>
            <input type="range" min="0" max="2.5" step="0.1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="accent-[var(--ma-accent)]" />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setWireframe((w) => !w)}
              className={\`h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 \${wireframe ? 'bg-[var(--ma-accent)] text-[var(--ma-accent-ink)] border-[var(--ma-accent)]' : 'bg-[var(--ma-bg)] border-[var(--ma-border)]'}\`}>
              <Grid3x3 size={14} /> Wireframe
            </button>
            <button type="button" onClick={resetCam}
              className="h-8 px-3 rounded-md border border-[var(--ma-border)] bg-[var(--ma-bg)] text-xs font-medium inline-flex items-center gap-1.5">
              <RotateCcw size={14} /> Reset view
            </button>
          </div>
        </div>

        <div className="rounded-[12px] overflow-hidden border border-[var(--ma-border)] bg-[var(--ma-surface)]">
          {webglError ? (
            <div className="h-[440px] grid place-items-center p-6 text-sm text-[var(--ma-danger)]">WebGL unavailable: {webglError}</div>
          ) : (
            <div ref={mountRef} className="w-full h-[440px]" />
          )}
        </div>
      </div>
    </div>
  );
}
`;

const REPORT_MD = `<style>
/* theme:start */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}
/* theme:end */
body{background:var(--ma-bg)!important;color:var(--ma-ink)!important;font-family:var(--ma-font-sans)}
#md-root{max-width:44rem;--tw-prose-body:var(--ma-ink);--tw-prose-headings:var(--ma-ink);--tw-prose-lead:var(--ma-muted);--tw-prose-links:var(--ma-accent);--tw-prose-bold:var(--ma-ink);--tw-prose-counters:var(--ma-muted);--tw-prose-bullets:var(--ma-muted);--tw-prose-hr:var(--ma-border);--tw-prose-quotes:var(--ma-ink);--tw-prose-quote-borders:var(--ma-highlight);--tw-prose-code:var(--ma-ink);--tw-prose-th-borders:var(--ma-border);--tw-prose-td-borders:var(--ma-border)}
#md-root h1,#md-root h2{font-family:var(--ma-font-display);letter-spacing:-.01em}
#md-root code{font-family:var(--ma-font-mono);background:var(--ma-sunken);padding:.1em .35em;border-radius:4px;font-weight:400}
#md-root code::before,#md-root code::after{content:none}
#md-root blockquote{background:var(--ma-highlight-soft);border-radius:0 8px 8px 0;padding:.6em 1em;font-style:normal}
#md-root blockquote p::before,#md-root blockquote p::after{content:none}
#md-root .my-6{background:var(--ma-surface)!important;border-color:var(--ma-border)!important}
.eyebrow{font-family:var(--ma-font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ma-muted)}
</style>

<p class="eyebrow">Report · October 2026</p>

# Sandbox latency review

> **Summary.** Median time to first render fell from 1.4s to 0.62s after caching compiled React artifacts. Mermaid renders are now the slowest path.

## Findings

| Artifact type | Before | After | Change |
| :-- | --: | --: | --: |
| React | 1.40s | 0.62s | −56% |
| HTML | 0.31s | 0.29s | −6% |
| Mermaid | 0.88s | 0.84s | −5% |
| Markdown | 0.45s | 0.41s | −9% |

1. Babel compilation was 70% of React render time. A content-hash cache removes it on reload.
2. Mermaid loads its full bundle on every render. Lazy-loading diagram types is the next step.

## How a render flows

\`\`\`mermaid
flowchart LR
  A[Artifact saved] --> B{Hash cached?}
  B -- yes --> C[Load compiled module]
  B -- no --> D[Babel compile] --> E[Store by hash] --> C
  C --> F[Render in sandbox]
\`\`\`

## Next steps

- [ ] Lazy-load Mermaid diagram renderers
- [ ] Add render timing to the State tab
- [x] Cache compiled React output by content hash`;

const DIAGRAM_MMD = `%%{init: {"theme":"base","themeVariables":{"fontFamily":"IBM Plex Sans, system-ui, sans-serif","fontSize":"14px","background":"#F7F4ED","primaryColor":"#E4EADF","primaryTextColor":"#1E2420","primaryBorderColor":"#55684F","lineColor":"#4A524A","secondaryColor":"#F8F1E3","secondaryBorderColor":"#C8A96B","tertiaryColor":"#EFEBE1","clusterBkg":"#FCFBF7","clusterBorder":"#E2DDD0","edgeLabelBackground":"#F7F4ED","nodeTextColor":"#1E2420"}}}%%
%% theme: moss — line 1 is the theme block; replace it to change theme (see themes.json)
flowchart LR
    subgraph Assistants["AI coding assistants"]
        CC["Claude Code"]
        CX["Codex"]
        AG["Antigravity"]
    end

    subgraph Bridge["Local bridge"]
        MCP["MCP stdio server"]
        CLI["myartifact CLI"]
        WATCH["Dropzone watcher"]
    end

    subgraph Store["~/.myartifact"]
        SQL[("SQLite + FTS5")]
        DISK["versions/v1..vN<br/>state.json"]
    end

    UI["Studio · 127.0.0.1:4173"]

    CC & CX & AG --> MCP & CLI & WATCH
    MCP & CLI & WATCH --> SQL & DISK
    SQL & DISK -- "REST + WebSocket" --> UI`;

const TOOL_HTML = `<!DOCTYPE html>
<!-- @title: Token Cost Estimator -->
<!-- @tags: template:tool, theme:moss -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    /* theme:start */
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    :root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}
    /* theme:end */
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:var(--ma-bg);color:var(--ma-ink);font-family:var(--ma-font-sans);font-size:14px;-webkit-font-smoothing:antialiased;padding:40px 20px}
    .card{max-width:520px;margin:0 auto;background:var(--ma-surface);border:1px solid var(--ma-border);border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:20px}
    h1{margin:0;font-family:var(--ma-font-display);font-size:20px;font-weight:600;letter-spacing:-.01em}
    .sub{margin:4px 0 0;color:var(--ma-muted);font-size:13px}
    label{display:flex;flex-direction:column;gap:6px}
    .row{display:flex;justify-content:space-between;font-size:13px;color:var(--ma-muted)}
    .row b{font-family:var(--ma-font-mono);font-weight:500;color:var(--ma-ink)}
    input[type=range]{width:100%;accent-color:var(--ma-accent)}
    .out{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:16px;border-top:1px solid var(--ma-border)}
    .stat{background:var(--ma-sunken);border-radius:10px;padding:14px}
    .stat span{font-size:12px;color:var(--ma-muted)}
    .stat div{margin-top:4px;font-family:var(--ma-font-mono);font-size:22px;font-weight:500}
    .stat.hl{background:var(--ma-accent-soft)}
    .foot{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ma-muted)}
    button{font:inherit;font-size:12px;font-weight:500;height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--ma-border);background:var(--ma-surface);color:var(--ma-ink);cursor:pointer}
  </style>
</head>
<body>
  <main class="card">
    <div>
      <h1>Token cost estimator</h1>
      <p class="sub">Inputs are saved to window.storage and restored on reload.</p>
    </div>
    <label><span class="row">Input tokens per call <b id="inV"></b></span><input id="inp" type="range" min="1000" max="200000" step="1000" value="16000" /></label>
    <label><span class="row">Output tokens per call <b id="outV"></b></span><input id="out" type="range" min="100" max="16000" step="100" value="1200" /></label>
    <label><span class="row">Calls per day <b id="callsV"></b></span><input id="calls" type="range" min="1" max="5000" step="1" value="250" /></label>
    <div class="out">
      <div class="stat"><span>Per call</span><div id="per">–</div></div>
      <div class="stat hl"><span>Per month</span><div id="month">–</div></div>
    </div>
    <div class="foot"><span>$3 / M input · $15 / M output</span><button id="reset" type="button">Reset</button></div>
  </main>
  <script>
    const KEY = 'tool:inputs';
    const DEFAULTS = { inp: 16000, out: 1200, calls: 250 };
    const ids = ['inp', 'out', 'calls'];
    const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    const fmt = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 });
    function render() {
      const v = Object.fromEntries(ids.map((id) => [id, Number(el[id].value)]));
      document.getElementById('inV').textContent = v.inp.toLocaleString();
      document.getElementById('outV').textContent = v.out.toLocaleString();
      document.getElementById('callsV').textContent = v.calls.toLocaleString();
      const per = (v.inp * 3 + v.out * 15) / 1e6;
      document.getElementById('per').textContent = fmt(per);
      document.getElementById('month').textContent = fmt(per * v.calls * 30);
      return v;
    }
    ids.forEach((id) => el[id].addEventListener('input', () => window.storage?.set(KEY, JSON.stringify(render()))));
    document.getElementById('reset').onclick = () => { ids.forEach((id) => (el[id].value = DEFAULTS[id])); window.storage?.set(KEY, JSON.stringify(render())); };
    (window.storage ? window.storage.get(KEY) : Promise.resolve(null))
      .then((r) => { if (r) { const s = JSON.parse(r.value); ids.forEach((id) => s[id] != null && (el[id].value = s[id])); } })
      .catch(() => {})
      .finally(render);
  </script>
</body>
</html>`;

export const KIT_TEMPLATES: KitTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    type: 'any',
    use: 'Start from an empty editor',
    content: '',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    type: 'react',
    use: 'KPIs, one trend chart, a persistent side panel.',
    content: DASHBOARD_TSX,
  },
  {
    id: 'scene-3d',
    label: '3D Scene',
    type: 'react',
    use: 'Interactive Three.js viewport with OrbitControls and persistent scene controls.',
    content: SCENE_3D_TSX,
  },
  {
    id: 'report',
    label: 'Report',
    type: 'markdown',
    use: 'Findings write-up with summary, table, diagram and next steps.',
    content: REPORT_MD,
  },
  {
    id: 'diagram',
    label: 'Diagram',
    type: 'mermaid',
    use: 'Architecture or flow with grouped subsystems.',
    content: DIAGRAM_MMD,
  },
  {
    id: 'tool',
    label: 'Mini-app',
    type: 'html',
    use: 'Single-purpose calculator or form that remembers its inputs.',
    content: TOOL_HTML,
  },
  {
    id: 'training',
    label: 'Training run',
    type: 'tensorboard',
    use: 'TensorBoard scalar curves, hyperparameters, and saved model checkpoints.',
    content: JSON.stringify(
      {
        runSlug: 'lora-finetune-run',
        title: 'LoRA Fine-Tuning Run',
        experiment: 'code-instruct-v1',
        modelName: 'Qwen2.5-Coder-7B-LoRA',
        framework: 'pytorch',
        status: 'completed',
        hparams: {
          optimizer: 'AdamW',
          learning_rate: 0.0002,
          batch_size: 32,
          lora_rank: 16,
          lora_alpha: 32,
          precision: 'bf16',
        },
        scalars: {
          'train/loss': [
            { tag: 'train/loss', step: 100, epoch: 0.2, value: 1.84, wallTime: 1730000100 },
            { tag: 'train/loss', step: 200, epoch: 0.4, value: 1.42, wallTime: 1730000200 },
            { tag: 'train/loss', step: 300, epoch: 0.6, value: 1.15, wallTime: 1730000300 },
            { tag: 'train/loss', step: 400, epoch: 0.8, value: 0.96, wallTime: 1730000400 },
            { tag: 'train/loss', step: 500, epoch: 1.0, value: 0.81, wallTime: 1730000500 },
            { tag: 'train/loss', step: 600, epoch: 1.2, value: 0.72, wallTime: 1730000600 },
          ],
          'val/loss': [
            { tag: 'val/loss', step: 200, epoch: 0.4, value: 1.38, wallTime: 1730000200 },
            { tag: 'val/loss', step: 400, epoch: 0.8, value: 0.94, wallTime: 1730000400 },
            { tag: 'val/loss', step: 600, epoch: 1.2, value: 0.75, wallTime: 1730000600 },
          ],
        },
        checkpoints: [],
        logDir: '~/.myartifact/runs/lora-finetune-run',
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
  },
];

function cssVars(t: KitTheme): string {
  return `:root{--ma-bg:${t.bg};--ma-surface:${t.surface};--ma-sunken:${t.sunken};--ma-border:${t.border};--ma-ink:${t.ink};--ma-muted:${t.muted};--ma-accent:${t.accent};--ma-accent-ink:${t.accentInk};--ma-accent-soft:${t.accentSoft};--ma-highlight:${t.highlight};--ma-highlight-soft:${t.highlightSoft};--ma-danger:${t.danger};--ma-font-sans:${t.fontSans};--ma-font-display:${t.fontDisplay};--ma-font-mono:${t.fontMono}}`;
}

function mermaidInit(t: KitTheme): string {
  const fam = t.fontSans.replace(/'/g, '');
  return `%%{init: {"theme":"base","themeVariables":{"fontFamily":"${fam}","fontSize":"14px","background":"${t.bg}","primaryColor":"${t.accentSoft}","primaryTextColor":"${t.ink}","primaryBorderColor":"${t.accent}","lineColor":"${t.muted}","secondaryColor":"${t.highlightSoft}","secondaryBorderColor":"${t.highlight}","tertiaryColor":"${t.sunken}","clusterBkg":"${t.surface}","clusterBorder":"${t.border}","edgeLabelBackground":"${t.bg}","nodeTextColor":"${t.ink}"}}}%%`;
}

export function applyTemplateTheme(
  type: ArtifactType | 'any',
  src: string,
  themeId: string
): string {
  const t = KIT_THEMES[themeId] || KIT_THEMES.moss;
  if (type === 'mermaid') {
    const lines = src.split('\n');
    lines[0] = mermaidInit(t);
    return lines.join('\n').replace(/%% theme: [\w-]+/, `%% theme: ${themeId}`);
  }
  const imp = `@import url('${KIT_FONTS_URL}');`;
  const out = src.replace(
    /(\/\* theme:start \*\/)[\s\S]*?(\/\* theme:end \*\/)/,
    (_, a: string, b: string) => {
      if (type === 'react') {
        return `${a}\nconst THEME = { name: '${themeId}', grid: '${t.border}', axis: '${t.muted}', surface: '${t.surface}', chart: [${t.chart.map((c) => `'${c}'`).join(', ')}] };\nconst THEME_CSS = \`${imp}\n${cssVars(t)}\`;\n${b}`;
      }
      const ind = type === 'html' ? '    ' : '';
      return `${a}\n${ind}${imp}\n${ind}${cssVars(t)}\n${ind}${b}`;
    }
  );
  return out.replace(/theme:[a-z-]+(?=[,\s])/g, (m) =>
    m === 'theme:start' || m === 'theme:end' ? m : `theme:${themeId}`
  );
}
