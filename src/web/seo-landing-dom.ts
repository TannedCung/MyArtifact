export interface SeoLandingRenderOptions {
  theme: 'day' | 'night';
  isCloudMode: boolean;
  googleEnabled: boolean;
  authenticated: boolean;
  userEmail?: string | null;
}

export interface SeoLandingBindCallbacks {
  onToggleTheme: () => void;
  onOpenStudio: () => void;
  onOpenSignIn: () => void;
}

export type ShowcaseTab = 'preview' | 'diff' | 'code' | 'state';
export type MetricView = 'grpo' | 'ppo' | 'kl';

export interface DemoArtifact {
  id: string;
  slug: string;
  title: string;
  runtimeLabel: string;
  type: 'react' | 'threejs' | 'mermaid' | 'tensorboard';
  projectPath: string;
  version: number;
  agentLabel: string;
  agentBg: string;
  agentFg: string;
  agentDot: string;
  code: string[];
  diff: Array<{ kind: 'ctx' | 'del' | 'add'; lineOld: string; lineNew: string; text: string }>;
  storage: Array<{ key: string; value: string; scope: string }>;
}

export const DEMO_ARTIFACTS: DemoArtifact[] = [
  {
    id: 'demo-react',
    slug: 'rl-locomotion-bench',
    title: 'RL Policy Benchmark',
    runtimeLabel: 'React',
    type: 'react',
    projectPath: 'robotics',
    version: 3,
    agentLabel: 'Claude Code',
    agentBg: 'var(--ag-claude-bg)',
    agentFg: 'var(--ag-claude-fg)',
    agentDot: 'var(--ag-claude-dot)',
    code: [
      'import { ResponsiveContainer, BarChart, Bar } from "recharts";',
      '',
      'export default function PolicyBenchmark() {',
      '  const [metric, setMetric] = useState("grpo");',
      '  return (',
      '    <Card title="Locomotion Policy Return">',
      '      <MetricToggle value={metric} onChange={persistKV} />',
      '      <ResponsiveContainer width="100%" height={200}>',
      '        <BarChart data={SERIES[metric]} />',
      '      </ResponsiveContainer>',
      '    </Card>',
      '  );',
      '}',
    ],
    diff: [
      { kind: 'ctx', lineOld: '3', lineNew: '3', text: 'export default function PolicyBenchmark() {' },
      { kind: 'del', lineOld: '4', lineNew: '', text: '  const [metric, setMetric] = useState("ppo");' },
      { kind: 'add', lineOld: '', lineNew: '4', text: '  const [metric, setMetric] = useState("grpo");' },
      { kind: 'add', lineOld: '', lineNew: '5', text: '  window.storage?.set("bench:metric", metric);' },
      { kind: 'ctx', lineOld: '6', lineNew: '7', text: '  return <Card title="Locomotion Policy Return" />;' },
    ],
    storage: [
      { key: 'bench:metric', value: '"grpo"', scope: 'workspace' },
      { key: 'selected_env', value: '"Humanoid-v4"', scope: 'workspace' },
      { key: 'viewer_filter', value: '"last_7d"', scope: 'viewer CoW' },
    ],
  },
  {
    id: 'demo-threejs',
    slug: 'kinematic-rig-viewport',
    title: '3D Kinematic Viewport',
    runtimeLabel: 'Three.js',
    type: 'threejs',
    projectPath: 'simulation',
    version: 2,
    agentLabel: 'Antigravity',
    agentBg: 'var(--ag-agy-bg)',
    agentFg: 'var(--ag-agy-fg)',
    agentDot: 'var(--ag-agy-dot)',
    code: [
      'import * as THREE from "three";',
      'import { Canvas } from "@react-three/fiber";',
      'import { OrbitControls } from "@react-three/drei";',
      '',
      'export default function KinematicViewport() {',
      '  return (',
      '    <Canvas camera={{ position: [3.2, 2.4, 3.6], fov: 42 }}>',
      '      <OrbitControls enableDamping />',
      '      <IsometricLatticeRig />',
      '    </Canvas>',
      '  );',
      '}',
    ],
    diff: [
      { kind: 'ctx', lineOld: '7', lineNew: '7', text: '<Canvas camera={{ position: [3.2, 2.4, 3.6] }}>' },
      { kind: 'del', lineOld: '8', lineNew: '', text: '  <meshStandardMaterial wireframe />' },
      { kind: 'add', lineOld: '', lineNew: '8', text: '  <OrbitControls enableDamping />' },
      { kind: 'add', lineOld: '', lineNew: '9', text: '  <IsometricLatticeRig />' },
    ],
    storage: [
      { key: 'camera_fov', value: '42', scope: 'workspace' },
      { key: 'orbit_damping', value: 'true', scope: 'workspace' },
    ],
  },
  {
    id: 'demo-mermaid',
    slug: 'cascading-rbac-topology',
    title: 'Cascading RBAC Graph',
    runtimeLabel: 'Mermaid',
    type: 'mermaid',
    projectPath: 'platform',
    version: 2,
    agentLabel: 'OpenAI Codex',
    agentBg: 'var(--ag-codex-bg)',
    agentFg: 'var(--ag-codex-fg)',
    agentDot: 'var(--ag-codex-dot)',
    code: [
      'flowchart LR',
      '  WS["Workspace (Owner)"] --> PRJ["Private Project"]',
      '  PRJ --> CAT["Category Folder"]',
      '  CAT --> ART["Artifact v1..vN"]',
      '  CLI["CLI / MCP Agent"] -.->|"Safe Ceiling"| ART',
    ],
    diff: [
      { kind: 'ctx', lineOld: '1', lineNew: '1', text: 'flowchart LR' },
      { kind: 'add', lineOld: '', lineNew: '2', text: '  WS["Workspace (Owner)"] --> PRJ["Private Project"]' },
      { kind: 'add', lineOld: '', lineNew: '5', text: '  CLI["CLI / MCP Agent"] -.->|"Safe Ceiling"| ART' },
    ],
    storage: [
      { key: 'diagram:layout', value: '"LR"', scope: 'workspace' },
      { key: 'inherit_workspace', value: 'false', scope: 'project ACL' },
    ],
  },
  {
    id: 'demo-tb',
    slug: 'qwen-grpo-run',
    title: 'Qwen-GRPO Curves',
    runtimeLabel: 'TensorBoard',
    type: 'tensorboard',
    projectPath: 'rl-runs',
    version: 4,
    agentLabel: 'Claude Code',
    agentBg: 'var(--ag-claude-bg)',
    agentFg: 'var(--ag-claude-fg)',
    agentDot: 'var(--ag-claude-dot)',
    code: [
      'tb_log_scalars({',
      '  run: "qwen-grpo-run",',
      '  step: 4000,',
      '  metrics: { "train/reward": 0.884, "train/kl_div": 0.024 }',
      '});',
      'tb_save_checkpoint({',
      '  run: "qwen-grpo-run",',
      '  name: "step-4000.safetensors",',
      '  isBest: true',
      '});',
    ],
    diff: [
      { kind: 'del', lineOld: '3', lineNew: '', text: '  step: 3200, metrics: { "train/reward": 0.812 }' },
      { kind: 'add', lineOld: '', lineNew: '3', text: '  step: 4000, metrics: { "train/reward": 0.884 }' },
    ],
    storage: [
      { key: 'tb:smoothing', value: '0.65', scope: 'workspace' },
      { key: 'tb:best_ckpt', value: '"step-4000.safetensors"', scope: 'R2 SigV4' },
    ],
  },
];

export const AGENT_BOOTSTRAP_PROMPT =
  'Read https://myartifact.app/llms.txt to connect and publish to MyArtifact Cloud. Check cloud auth with npx myartifact whoami (if not logged in, ask the human to run npx myartifact login --cloud https://myartifact.app && npx myartifact setup). Always call artifact_wiki_index() first, prefer interactive react/html/threejs/mermaid/tensorboard artifacts over plain markdown, iterate with artifact_update + [[wiki-links]], and return the live https://myartifact.app/artifacts/<slug> URL.';

const COPY_PAYLOADS: Record<string, string> = {
  'hero-cloud': 'npx myartifact login --cloud https://myartifact.app',
  setup: 'npx myartifact setup',
  'human-login': 'npx myartifact login --cloud https://myartifact.app',
  'human-device': 'npx myartifact login --cloud https://myartifact.app --device',
  'human-setup': 'npx myartifact setup',
  'agent-prompt': AGENT_BOOTSTRAP_PROMPT,
};

export const STAGE_SVG = {
  check: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  copy: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  sun: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  moon: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
  history: (cls = 'w-3 h-3') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  gitCompare: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/></svg>`,
};

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderStageHtml(
  artifact: DemoArtifact,
  tab: ShowcaseTab,
  metricView: MetricView
): string {
  if (tab === 'preview' && artifact.type === 'react') {
    const grpoVal = metricView === 'grpo' ? '0.884' : metricView === 'ppo' ? '92.4%' : '0.024';
    const baseVal = metricView === 'grpo' ? '0.770' : metricView === 'ppo' ? '81.0%' : '0.049';
    const heights =
      metricView === 'grpo'
        ? [36, 44, 52, 61, 69, 78, 86, 94, 99, 105]
        : metricView === 'ppo'
          ? [44, 52, 58, 66, 73, 81, 88, 93, 98, 104]
          : [96, 88, 79, 71, 63, 55, 48, 41, 35, 29];

    const metricBtns = (
      [
        ['grpo', 'Reward'],
        ['ppo', 'Pass %'],
        ['kl', 'KL Div'],
      ] as const
    )
      .map(([k, lbl]) => {
        const cls = metricView === k ? 'bg-sage text-canvas' : 'text-ink-2 hover:text-ink';
        return `<button type="button" data-ma-metric="${k}" class="min-h-[32px] px-3 rounded-[5px] font-medium transition-colors ${cls}">${lbl}</button>`;
      })
      .join('');

    const barsSvg = heights
      .map((h, i) => {
        const x = 24 + i * 60;
        const fill = i >= 7 ? 'var(--c-sage)' : 'var(--c-sage-soft)';
        return `<g><rect x="${x}" y="${112 - h}" width="36" height="${h}" rx="5" fill="${fill}" stroke="var(--c-sage-border)" /><circle cx="${x + 18}" cy="${112 - h - 6}" r="3" fill="#C8A96B" /></g>`;
      })
      .join('');

    return `
      <div class="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">GRPO vs PPO Multi-Task Return</span>
          <div class="flex items-center gap-1 bg-sunken p-1 rounded-[7px] border border-line text-[11.5px]">${metricBtns}</div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
          <div class="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
            <div class="font-mono text-[10.5px] uppercase text-ink-3">GRPO Policy</div>
            <div class="font-mono text-[18px] sm:text-[22px] font-semibold text-sage sm:mt-1">${grpoVal}</div>
          </div>
          <div class="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
            <div class="font-mono text-[10.5px] uppercase text-ink-3">Baseline</div>
            <div class="font-mono text-[18px] sm:text-[22px] font-semibold text-brass-ink sm:mt-1">${baseVal}</div>
          </div>
          <div class="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
            <div class="font-mono text-[10.5px] uppercase text-ink-3">KV State</div>
            <div class="font-mono text-[13.5px] sm:text-[14px] font-semibold text-ink sm:mt-2 truncate">bench:${metricView}</div>
          </div>
        </div>
        <div class="p-3 rounded-[9px] border border-line bg-canvas">
          <svg viewBox="0 0 640 120" class="w-full h-[118px]" aria-hidden="true">
            <line x1="12" y1="28" x2="628" y2="28" stroke="var(--c-line)" stroke-dasharray="3 4" />
            <line x1="12" y1="60" x2="628" y2="60" stroke="var(--c-line)" stroke-dasharray="3 4" />
            <line x1="12" y1="92" x2="628" y2="92" stroke="var(--c-line)" stroke-dasharray="3 4" />
            ${barsSvg}
          </svg>
        </div>
      </div>`;
  }

  if (tab === 'preview' && artifact.type === 'threejs') {
    const hLines = [0, 1, 2, 3, 4, 5, 6]
      .map(
        (i) =>
          `<line x1="${90 + i * 16}" y1="${198 - i * 16}" x2="${550 - i * 16}" y2="${198 - i * 16}" stroke="#263329" stroke-width="1.2" />`
      )
      .join('');
    const vLines = [-3, -2, -1, 0, 1, 2, 3]
      .map(
        (k) =>
          `<line x1="${320 + k * 42}" y1="198" x2="${320 + k * 24}" y2="102" stroke="#263329" stroke-width="1.2" />`
      )
      .join('');

    return `
      <div class="rounded-[12px] border border-[#2D352E] bg-[#131A15] p-5 text-[#ECEAE3] relative overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-[#98AC93]">Three.js + R3F Sandbox Viewport</span>
          <span class="font-mono text-[10.5px] px-2 py-0.5 rounded bg-[#1F2A20] border border-[#3E4C3B] text-[#C7D3C0]">60 FPS · WebGL2 · OrbitControls</span>
        </div>
        <svg viewBox="0 0 640 220" class="w-full h-[210px]" aria-hidden="true">
          ${hLines}
          ${vLines}
          <polygon points="320,34 404,78 320,122 236,78" fill="#55684F" fill-opacity="0.45" stroke="#98AC93" stroke-width="2" />
          <polygon points="236,78 320,122 320,186 236,142" fill="#2A352B" fill-opacity="0.72" stroke="#98AC93" stroke-width="1.8" />
          <polygon points="404,78 320,122 320,186 404,142" fill="#1D261F" fill-opacity="0.85" stroke="#C8A96B" stroke-width="1.8" />
          <line x1="320" y1="34" x2="320" y2="186" stroke="#C8A96B" stroke-dasharray="4 4" stroke-width="1.5" />
          <circle cx="320" cy="34" r="5" fill="#C8A96B" />
          <line x1="560" y1="176" x2="594" y2="176" stroke="#8FA28A" stroke-width="2.5" stroke-linecap="round" />
          <line x1="560" y1="176" x2="560" y2="142" stroke="#C8A96B" stroke-width="2.5" stroke-linecap="round" />
          <line x1="560" y1="176" x2="538" y2="192" stroke="#7C93A8" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </div>`;
  }

  if (tab === 'preview' && artifact.type === 'mermaid') {
    const nodes = [
      { tier: 'Workspace', role: 'Owner', bg: 'bg-sage-soft/65 border-[var(--c-sage-border)]' },
      { tier: 'Private Project', role: 'Admin', bg: 'bg-brass-soft/65 border-brass-line' },
      { tier: 'Category', role: 'Editor', bg: 'bg-canvas border-line' },
      { tier: 'Artifact v2', role: 'Safe Agent', bg: 'bg-sage-soft border-[var(--c-sage-border)]' },
    ]
      .map(
        (n) => `
        <div class="p-4 rounded-[10px] border text-center ${n.bg}">
          <div class="text-[13.5px] font-semibold text-ink">${n.tier}</div>
          <div class="font-mono text-[11px] text-ink-3 mt-1">${n.role}</div>
        </div>`
      )
      .join('');

    return `
      <div class="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-5">
        <div class="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">Mermaid v11 · Cascading Access Control</div>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">${nodes}</div>
      </div>`;
  }

  if (tab === 'preview' && artifact.type === 'tensorboard') {
    return `
      <div class="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">TensorBoard Scalar Stream · Step 4,000</span>
          <span class="font-mono text-[11px] px-2.5 py-0.5 rounded bg-brass-soft text-brass-ink border border-brass-line">step-4000.safetensors · R2 SigV4</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="p-3.5 rounded-[9px] border border-line bg-canvas">
            <div class="flex justify-between font-mono text-[11.5px] text-ink-2 mb-2">
              <span>train/reward</span>
              <span class="text-sage font-semibold">0.884</span>
            </div>
            <svg viewBox="0 0 280 90" class="w-full h-[90px]" aria-hidden="true">
              <line x1="0" y1="30" x2="280" y2="30" stroke="var(--c-line)" stroke-dasharray="3 4" />
              <line x1="0" y1="60" x2="280" y2="60" stroke="var(--c-line)" stroke-dasharray="3 4" />
              <path d="M 8 76 Q 70 68, 120 48 T 272 14" fill="none" stroke="var(--c-sage)" stroke-width="3" stroke-linecap="round" />
            </svg>
          </div>
          <div class="p-3.5 rounded-[9px] border border-line bg-canvas">
            <div class="flex justify-between font-mono text-[11.5px] text-ink-2 mb-2">
              <span>train/kl_div</span>
              <span class="text-brass-ink font-semibold">0.024</span>
            </div>
            <svg viewBox="0 0 280 90" class="w-full h-[90px]" aria-hidden="true">
              <line x1="0" y1="30" x2="280" y2="30" stroke="var(--c-line)" stroke-dasharray="3 4" />
              <line x1="0" y1="60" x2="280" y2="60" stroke="var(--c-line)" stroke-dasharray="3 4" />
              <path d="M 8 24 Q 70 58, 130 42 T 272 28" fill="none" stroke="#C8A96B" stroke-width="3" stroke-linecap="round" />
            </svg>
          </div>
        </div>
      </div>`;
  }

  if (tab === 'diff') {
    const rows = artifact.diff
      .map((row) => {
        const cls =
          row.kind === 'add'
            ? 'bg-add text-add-ink'
            : row.kind === 'del'
              ? 'bg-del text-del-ink'
              : 'text-ink-2';
        const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
        return `<div class="grid grid-cols-[34px_34px_20px_1fr] px-2 ${cls}"><span aria-hidden="true" class="text-right pr-2 text-ink-3 select-none">${escapeHtml(row.lineOld)}</span><span aria-hidden="true" class="text-right pr-2 text-ink-3 select-none">${escapeHtml(row.lineNew)}</span><span aria-hidden="true" class="select-none font-semibold">${marker}</span><pre class="m-0 whitespace-pre">${escapeHtml(row.text)}</pre></div>`;
      })
      .join('');

    return `
      <div class="rounded-[12px] border border-line bg-raised overflow-hidden font-mono text-[12px] leading-[1.65]">
        <div class="px-4 py-2 border-b border-line bg-sunken text-ink-2 flex items-center gap-2">
          ${STAGE_SVG.gitCompare('w-3.5 h-3.5 text-sage')}
          <span>v${Math.max(1, artifact.version - 1)} → v${artifact.version}</span>
        </div>
        <div class="divide-y divide-line/40 overflow-x-auto">${rows}</div>
      </div>`;
  }

  if (tab === 'code') {
    const codeLines = artifact.code
      .map(
        (ln, idx) =>
          `<div class="grid grid-cols-[32px_1fr] gap-3"><span aria-hidden="true" class="text-right text-ink-3 select-none">${idx + 1}</span><pre class="m-0 text-ink whitespace-pre">${ln ? escapeHtml(ln) : ' '}</pre></div>`
      )
      .join('');

    return `
      <div class="rounded-[12px] border border-line bg-raised overflow-hidden">
        <div class="px-4 py-2 border-b border-line bg-sunken flex items-center justify-between">
          <span class="font-mono text-[11.5px] text-ink-2">${escapeHtml(artifact.slug)} · v${artifact.version}</span>
          <button type="button" data-ma-copy="code" aria-label="Copy source code snippet" class="min-h-[32px] px-2.5 rounded bg-raised border border-line text-[11.5px] font-mono text-ink-2 hover:text-ink inline-flex items-center gap-1 transition-colors">
            ${STAGE_SVG.copy('w-3 h-3')}
            <span>Copy</span>
          </button>
        </div>
        <div class="p-3.5 font-mono text-[12px] leading-[1.6] overflow-x-auto">${codeLines}</div>
      </div>`;
  }

  const rows = artifact.storage
    .map(
      (entry) =>
        `<tr><td class="py-2.5 px-4 font-mono text-ink font-medium">${escapeHtml(entry.key)}</td><td class="py-2.5 px-4 font-mono text-ink-2">${escapeHtml(entry.value)}</td><td class="py-2.5 px-4 font-mono text-[11px] text-sage">${escapeHtml(entry.scope)}</td></tr>`
    )
    .join('');

  return `
    <div class="rounded-[12px] border border-line bg-raised overflow-hidden">
      <div class="px-4 py-2 border-b border-line bg-sunken text-[11.5px] font-mono text-ink-2">window.storage · Viewer Copy-on-Write Isolation</div>
      <table class="w-full text-left border-collapse text-[12.5px]">
        <thead>
          <tr class="border-b border-line text-ink-3 font-mono text-[11px] uppercase">
            <th class="py-2.5 px-4 font-medium">Key</th>
            <th class="py-2.5 px-4 font-medium">Value</th>
            <th class="py-2.5 px-4 font-medium">Scope</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">${rows}</tbody>
      </table>
    </div>`;
}

export function syncSeoLandingTheme(root: ParentNode, theme: 'day' | 'night'): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-ma-action="toggle-theme"]');
  if (!btn) return;
  const label = theme === 'night' ? 'Switch to day theme' : 'Switch to night theme';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.innerHTML = theme === 'night' ? STAGE_SVG.sun() : STAGE_SVG.moon();
}

export function bindSeoLandingEvents(
  root: HTMLElement,
  callbacks: SeoLandingBindCallbacks
): () => void {
  let selectedId = DEMO_ARTIFACTS[0].id;
  let activeTab: ShowcaseTab = 'preview';
  let metricView: MetricView = 'grpo';
  let copyTimer: number | null = null;
  let activeCopyBtn: HTMLButtonElement | null = null;

  const getArtifact = (): DemoArtifact =>
    DEMO_ARTIFACTS.find((a) => a.id === selectedId) || DEMO_ARTIFACTS[0];

  const updateStage = () => {
    const artifact = getArtifact();

    const chromePath = root.querySelector<HTMLElement>('[data-ma-chrome-path]');
    if (chromePath) {
      chromePath.textContent = `myartifact.app / ${artifact.projectPath} / ${artifact.slug}`;
    }

    const chromeVer = root.querySelector<HTMLElement>('[data-ma-chrome-ver]');
    if (chromeVer) {
      chromeVer.innerHTML = `${STAGE_SVG.history()}v${artifact.version} LATEST`;
    }

    const titleEl = root.querySelector<HTMLElement>('[data-ma-canvas-title]');
    if (titleEl) titleEl.textContent = artifact.title;

    const agentEl = root.querySelector<HTMLElement>('[data-ma-canvas-agent]');
    if (agentEl) {
      agentEl.style.backgroundColor = artifact.agentBg;
      agentEl.style.color = artifact.agentFg;
      agentEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full" style="background-color:${artifact.agentDot}" aria-hidden="true"></span>${escapeHtml(artifact.agentLabel)}`;
    }

    root.querySelectorAll<HTMLButtonElement>('[data-ma-artifact]').forEach((btn) => {
      const isSel = btn.dataset.maArtifact === artifact.id;
      btn.setAttribute('aria-pressed', String(isSel));
      btn.classList.toggle('bg-sage-soft', isSel);
      btn.classList.toggle('shadow-[inset_2px_0_0_var(--color-sage)]', isSel);
      btn.classList.toggle('hover:bg-sunken', !isSel);
      const iconBox = btn.querySelector<HTMLElement>('[data-ma-art-icon]');
      if (iconBox) {
        iconBox.classList.toggle('bg-raised', isSel);
        iconBox.classList.toggle('border', isSel);
        iconBox.classList.toggle('border-[var(--c-sage-border)]', isSel);
        iconBox.classList.toggle('text-sage', isSel);
        iconBox.classList.toggle('bg-sunken', !isSel);
        iconBox.classList.toggle('text-ink-2', !isSel);
      }
    });

    root.querySelectorAll<HTMLButtonElement>('[data-ma-tab]').forEach((btn) => {
      const isSel = btn.dataset.maTab === activeTab;
      btn.setAttribute('aria-pressed', String(isSel));
      btn.classList.toggle('bg-raised', isSel);
      btn.classList.toggle('text-ink', isSel);
      btn.classList.toggle('shadow-[0_1px_2px_rgba(30,36,32,0.08)]', isSel);
      btn.classList.toggle('text-ink-3', !isSel);
      btn.classList.toggle('hover:text-ink', !isSel);
    });

    const stage = root.querySelector<HTMLElement>('[data-ma-stage]');
    if (stage) {
      stage.innerHTML = renderStageHtml(artifact, activeTab, metricView);
    }
  };

  const resetCopyLabel = (btn: HTMLButtonElement) => {
    const kind = btn.dataset.maCopy;
    const orig = btn.dataset.maOrigLabel || (kind === 'agent-prompt' ? 'Copy Prompt' : 'Copy');
    const iconCls = kind === 'setup' || kind === 'hero-cloud' ? 'w-3.5 h-3.5' : 'w-3 h-3';
    btn.innerHTML = `${STAGE_SVG.copy(iconCls)}<span>${orig}</span>`;
  };

  const handleCopy = async (btn: HTMLButtonElement, kind: string) => {
    const text = kind === 'code' ? getArtifact().code.join('\n') : COPY_PAYLOADS[kind];
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }

    if (activeCopyBtn && activeCopyBtn !== btn) {
      resetCopyLabel(activeCopyBtn);
    }
    if (!btn.dataset.maOrigLabel) {
      btn.dataset.maOrigLabel = btn.textContent?.trim() || 'Copy';
    }
    if (copyTimer !== null) {
      window.clearTimeout(copyTimer);
    }

    const iconCls =
      kind === 'setup' || kind === 'hero-cloud' ? 'w-3.5 h-3.5 text-sage' : 'w-3 h-3 text-sage';
    btn.innerHTML = `${STAGE_SVG.check(iconCls)}<span>Copied</span>`;
    activeCopyBtn = btn;

    copyTimer = window.setTimeout(() => {
      if (btn.isConnected) {
        resetCopyLabel(btn);
      }
      if (activeCopyBtn === btn) activeCopyBtn = null;
      copyTimer = null;
    }, 1800);
  };

  const onClick = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const actionEl = target.closest<HTMLElement>('[data-ma-action]');
    if (actionEl) {
      const action = actionEl.dataset.maAction;
      if (action === 'toggle-theme') {
        callbacks.onToggleTheme();
        return;
      }
      if (action === 'open-studio') {
        callbacks.onOpenStudio();
        return;
      }
      if (action === 'open-signin') {
        callbacks.onOpenSignIn();
        return;
      }
    }

    const artBtn = target.closest<HTMLButtonElement>('[data-ma-artifact]');
    if (artBtn?.dataset.maArtifact) {
      selectedId = artBtn.dataset.maArtifact;
      updateStage();
      return;
    }

    const tabBtn = target.closest<HTMLButtonElement>('[data-ma-tab]');
    if (tabBtn?.dataset.maTab) {
      activeTab = tabBtn.dataset.maTab as ShowcaseTab;
      updateStage();
      return;
    }

    const metricBtn = target.closest<HTMLButtonElement>('[data-ma-metric]');
    if (metricBtn?.dataset.maMetric) {
      metricView = metricBtn.dataset.maMetric as MetricView;
      updateStage();
      return;
    }

    const copyBtn = target.closest<HTMLButtonElement>('[data-ma-copy]');
    if (copyBtn?.dataset.maCopy) {
      void handleCopy(copyBtn, copyBtn.dataset.maCopy);
    }
  };

  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('click', onClick);
    if (copyTimer !== null) {
      window.clearTimeout(copyTimer);
      copyTimer = null;
    }
  };
}
