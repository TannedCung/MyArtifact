import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Atom,
  Box,
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  FolderTree,
  GitCompare,
  History,
  Lock,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Workflow,
} from 'lucide-react';
import { MYARTIFACT_LOGO_SVG } from '../../core/brand-logo.js';

export interface SeoLandingPageProps {
  theme: 'day' | 'night';
  onToggleTheme: () => void;
  isCloudMode: boolean;
  googleEnabled: boolean;
  authenticated: boolean;
  userEmail?: string | null;
  onOpenStudio: () => void;
  onOpenSignIn: () => void;
}

type ShowcaseTab = 'preview' | 'diff' | 'code' | 'state';

interface DemoArtifact {
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

const DEMO_ARTIFACTS: DemoArtifact[] = [
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
      'tensorboard_log_scalars({',
      '  slug: "qwen-grpo-run",',
      '  step: 4000,',
      '  metrics: { "train/reward": 0.884, "train/kl_div": 0.024 }',
      '});',
      'tensorboard_save_checkpoint({',
      '  slug: "qwen-grpo-run",',
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

const COMPARISON_ROWS: Array<{
  label: string;
  myArtifact: string;
  chatLocked: string;
  rawFiles: string;
  maPositive?: boolean;
}> = [
  {
    label: 'Shared across Claude Code, Codex & Antigravity',
    myArtifact: 'MCP + CLI',
    chatLocked: 'Per-chat only',
    rawFiles: 'Manual copy',
    maPositive: true,
  },
  {
    label: 'React, Three.js, Mermaid, KaTeX & TensorBoard',
    myArtifact: '7 runtimes',
    chatLocked: 'Partial',
    rawFiles: 'Manual setup',
    maPositive: true,
  },
  {
    label: 'Immutable versions, diffs & window.storage',
    myArtifact: 'Built-in',
    chatLocked: 'Ephemeral',
    rawFiles: 'Manual git',
    maPositive: true,
  },
  {
    label: 'Google OIDC cascading RBAC & batch sharing',
    myArtifact: '4-tier ACL',
    chatLocked: 'Public link',
    rawFiles: 'None',
    maPositive: true,
  },
  {
    label: '100% offline local mode + $0/mo cloud deploy',
    myArtifact: 'MIT Open Source',
    chatLocked: 'Cloud only',
    rawFiles: 'Local only',
    maPositive: true,
  },
];

const FAQ_ITEMS = [
  {
    q: 'How is MyArtifact different from chat-locked Claude or GPT Artifacts?',
    a: 'MyArtifact gives Claude Code, OpenAI Codex, and Google Antigravity one persistent visual workspace instead of trapping UI previews inside individual chat threads.',
  },
  {
    q: 'Can I run MyArtifact 100% offline without cloud accounts?',
    a: 'Yes. Running npx myartifact setup and myartifact serve stores all artifacts, versions, FTS5 search indexes, and window.storage state locally in ~/.myartifact with zero cloud dependency.',
  },
  {
    q: 'How do local coding agents safely access Cloud workspaces?',
    a: 'Run myartifact login once via Google OIDC. Local CLI and MCP tools inherit your RBAC role under a Safe Agent Scope Ceiling that blocks deletes and sharing changes unless --elevate is passed.',
  },
  {
    q: 'How does cascading RBAC and Batch Sharing work?',
    a: 'Roles cascade across Workspace -> Project -> Category -> Artifact (with optional private projects), and Batch Sharing grants access across emails, workspace groups, verified Google domains, or expiring links.',
  },
  {
    q: 'What does it cost to self-host MyArtifact Cloud?',
    a: 'MyArtifact is MIT-licensed and runs at $0/month on Vercel Hobby serverless functions (using conditional ETag /api/sync), Neon Free Postgres, and Cloudflare R2.',
  },
];

export const SeoLandingPage: React.FC<SeoLandingPageProps> = ({
  theme,
  onToggleTheme,
  isCloudMode,
  googleEnabled,
  authenticated,
  userEmail,
  onOpenStudio,
  onOpenSignIn,
}) => {
  const [selectedId, setSelectedId] = useState<string>(DEMO_ARTIFACTS[0].id);
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('preview');
  const [metricView, setMetricView] = useState<'grpo' | 'ppo' | 'kl'>('grpo');
  const [copiedCmd, setCopiedCmd] = useState<'setup' | 'code' | null>(null);

  const selectedArtifact = useMemo(
    () => DEMO_ARTIFACTS.find((a) => a.id === selectedId) || DEMO_ARTIFACTS[0],
    [selectedId]
  );

  const handleCopy = async (kind: 'setup' | 'code', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard permission errors in headless previews
    }
    setCopiedCmd(kind);
    setTimeout(() => {
      setCopiedCmd((prev) => (prev === kind ? null : prev));
    }, 1800);
  };

  const primaryCtaIsStudio = !isCloudMode || authenticated;
  const googleLoginHref = '/api/auth/google/login?next=%2F';

  const renderPrimaryCta = (large = false) => {
    const sizeCls = large
      ? 'h-[44px] px-5 text-[14px] rounded-[9px]'
      : 'h-[36px] px-3.5 text-[13px] rounded-[7px]';

    if (primaryCtaIsStudio) {
      return (
        <button
          onClick={onOpenStudio}
          className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)]`}
        >
          <span>{authenticated ? 'Open Studio' : 'Launch Studio'}</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      );
    }

    if (googleEnabled) {
      return (
        <a
          href={googleLoginHref}
          className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)] no-underline whitespace-nowrap shrink-0`}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
            />
          </svg>
          {large ? (
            <span>Continue with Google</span>
          ) : (
            <>
              <span className="hidden sm:inline">Continue with Google</span>
              <span className="sm:hidden">Sign in</span>
            </>
          )}
        </a>
      );
    }

    return (
      <button
        onClick={onOpenSignIn}
        className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors`}
      >
        <span>Sign In</span>
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div id="top" className="min-h-screen bg-canvas text-ink selection:bg-[#C7D3C0] selection:text-[#1E2420]">
      {/* Minimal Sticky Top Bar */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/88 backdrop-blur-md">
        <div className="max-w-[1120px] mx-auto px-4 sm:px-8 h-[60px] flex items-center justify-between gap-3">
          <a href="#top" className="flex items-center gap-2.5 text-ink no-underline shrink-0">
            <span
              aria-hidden="true"
              className="w-[28px] h-[28px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.12)] [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
            />
            <span className="font-semibold text-[15px] tracking-tight text-ink whitespace-nowrap">
              MyArtifact
            </span>
          </a>

          <nav aria-label="Primary sections" className="hidden md:flex items-center gap-7 text-[13.5px] text-ink-2">
            <a href="#studio" className="hover:text-ink transition-colors no-underline py-1">
              Studio
            </a>
            <a href="#features" className="hover:text-ink transition-colors no-underline py-1">
              Features
            </a>
            <a href="#faq" className="hover:text-ink transition-colors no-underline py-1">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleTheme}
              aria-label={theme === 'night' ? 'Switch to day theme' : 'Switch to night theme'}
              title={theme === 'night' ? 'Switch to day theme' : 'Switch to night theme'}
              className="w-[36px] h-[36px] rounded-[7px] border border-line bg-raised hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors"
            >
              {theme === 'night' ? (
                <Sun className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Moon className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <a
              href="https://github.com/TannedCung/MyArtifact"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex h-[36px] px-3 rounded-[7px] border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink text-[12.5px] font-medium items-center gap-1.5 transition-colors no-underline"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>

            {renderPrimaryCta(false)}
          </div>
        </div>
      </header>

      <main id="main-content">
        {/* Centered Atmospheric Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-65"
            style={{
              backgroundImage:
                'radial-gradient(var(--c-line-strong) 1px, transparent 1px), radial-gradient(ellipse 70% 55% at 50% 0%, var(--c-sage-soft), transparent 72%)',
              backgroundSize: '24px 24px, 100% 100%',
            }}
          />

          <div className="relative max-w-[1120px] mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-raised border border-line text-[11.5px] font-mono uppercase tracking-[0.07em] text-sage shadow-[0_1px_2px_rgba(30,36,32,0.04)] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--c-live-dot)]" aria-hidden="true" />
              <span>Open-Source MCP Studio · MIT</span>
            </div>

            <h1 className="font-serif text-[36px] sm:text-[54px] leading-[1.08] tracking-[-0.025em] font-semibold text-ink m-0 max-w-[820px] mx-auto">
              One visual studio for <br className="hidden sm:inline" />
              <span className="text-sage italic font-medium">every coding agent.</span>
            </h1>

            <p className="mt-5 text-[16px] sm:text-[18.5px] leading-[1.6] text-ink-2 max-w-[600px] mx-auto">
              Render, diff, and share live React, 3D, Mermaid &amp; TensorBoard artifacts across Claude Code, Codex, and Antigravity.
            </p>

            {/* Primary CTA + Non-truncating Copyable Terminal Pill */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {renderPrimaryCta(true)}

              <div className="h-[44px] inline-flex items-center gap-2.5 pl-3.5 pr-1.5 rounded-[9px] border border-line-strong bg-raised shadow-[0_1px_2px_rgba(30,36,32,0.05)]">
                <Terminal className="w-4 h-4 text-sage shrink-0" aria-hidden="true" />
                <code className="font-mono text-[13px] text-ink whitespace-nowrap">
                  npx myartifact setup
                </code>
                <button
                  onClick={() => handleCopy('setup', 'npx myartifact setup')}
                  aria-label="Copy npx myartifact setup command"
                  className="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-canvas hover:bg-sunken text-[11.5px] font-mono text-ink-2 inline-flex items-center gap-1 transition-colors"
                >
                  {copiedCmd === 'setup' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-sage" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Subtle Agent Compatibility Strip */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[12px]">
              {[
                { label: 'Claude Code', bg: 'var(--ag-claude-bg)', fg: 'var(--ag-claude-fg)', dot: 'var(--ag-claude-dot)' },
                { label: 'OpenAI Codex', bg: 'var(--ag-codex-bg)', fg: 'var(--ag-codex-fg)', dot: 'var(--ag-codex-dot)' },
                { label: 'Google Antigravity', bg: 'var(--ag-agy-bg)', fg: 'var(--ag-agy-fg)', dot: 'var(--ag-agy-dot)' },
              ].map((ag) => (
                <span
                  key={ag.label}
                  style={{ backgroundColor: ag.bg, color: ag.fg }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border border-line/70"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ag.dot }} aria-hidden="true" />
                  {ag.label}
                </span>
              ))}

              {isCloudMode && !authenticated && (
                <button
                  onClick={onOpenSignIn}
                  className="min-h-[30px] px-2.5 rounded-full border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink font-mono text-[11.5px] inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>CLI Sign-In</span>
                </button>
              )}

              {authenticated && userEmail && (
                <span className="font-mono text-[11.5px] px-2.5 py-1 rounded-full bg-sunken text-ink-2 border border-line">
                  {userEmail}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Elevated Studio Window Centerpiece */}
        <section
          id="studio"
          aria-labelledby="studio-heading"
          className="max-w-[1080px] mx-auto px-5 sm:px-8 pb-20"
        >
          <h2 id="studio-heading" className="sr-only">
            Interactive MyArtifact Studio Preview
          </h2>

          <div className="rounded-[16px] border border-line-strong bg-raised shadow-[0_24px_64px_rgba(30,36,32,0.13)] overflow-hidden">
            {/* macOS / Studio Window Chrome Bar */}
            <div className="h-[42px] px-4 border-b border-line bg-canvas flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
              </div>

              <div className="px-3 py-0.5 rounded-full bg-raised border border-line font-mono text-[11px] text-ink-3 truncate max-w-[380px]">
                myartifact.app / {selectedArtifact.projectPath} / {selectedArtifact.slug}
              </div>

              <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-brass-soft text-brass-ink border border-brass-line shrink-0 inline-flex items-center gap-1">
                <History className="w-3 h-3" aria-hidden="true" />
                v{selectedArtifact.version} LATEST
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[248px_1fr]">
              {/* Left Sidebar */}
              <aside className="bg-canvas/70 border-b lg:border-b-0 lg:border-r border-line p-2.5 flex flex-col gap-1">
                {DEMO_ARTIFACTS.map((item) => {
                  const isSel = item.id === selectedArtifact.id;
                  const TypeIcon =
                    item.type === 'react'
                      ? Atom
                      : item.type === 'threejs'
                      ? Box
                      : item.type === 'mermaid'
                      ? Workflow
                      : Activity;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full text-left px-2.5 py-2.5 rounded-[9px] grid grid-cols-[28px_1fr_auto] gap-2.5 items-center transition-colors ${
                        isSel
                          ? 'bg-sage-soft shadow-[inset_2px_0_0_var(--color-sage)]'
                          : 'hover:bg-sunken'
                      }`}
                    >
                      <span
                        className={`w-[28px] h-[28px] rounded-[6px] flex items-center justify-center ${
                          isSel
                            ? 'bg-raised border border-[var(--c-sage-border)] text-sage'
                            : 'bg-sunken text-ink-2'
                        }`}
                      >
                        <TypeIcon className="w-[15px] h-[15px]" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-ink truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-ink-3 truncate">
                          {item.runtimeLabel} · {item.agentLabel}
                        </div>
                      </div>
                      <span className="font-mono text-[10.5px] px-1.5 py-[1px] rounded bg-brass-soft text-brass-ink border border-brass-line">
                        v{item.version}
                      </span>
                    </button>
                  );
                })}
              </aside>

              {/* Right Main Canvas */}
              <div className="flex flex-col min-w-0 bg-raised">
                <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h3 className="m-0 text-[15px] font-semibold text-ink truncate">
                      {selectedArtifact.title}
                    </h3>
                    <span
                      style={{
                        backgroundColor: selectedArtifact.agentBg,
                        color: selectedArtifact.agentFg,
                      }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: selectedArtifact.agentDot }}
                        aria-hidden="true"
                      />
                      {selectedArtifact.agentLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 rounded-[8px] bg-sunken p-1 border border-line flex-wrap">
                    {(
                      [
                        ['preview', 'Preview'],
                        ['diff', 'Diff'],
                        ['code', 'Code'],
                        ['state', 'State'],
                      ] as const
                    ).map(([tabId, label]) => (
                      <button
                        key={tabId}
                        onClick={() => setActiveTab(tabId)}
                        className={`min-h-[34px] px-3 rounded-[6px] text-[12px] font-medium transition-colors ${
                          activeTab === tabId
                            ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(30,36,32,0.08)]'
                            : 'text-ink-3 hover:text-ink'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inspector Stage */}
                <div className="p-5 min-h-[330px] bg-canvas/30 flex flex-col justify-center">
                  {activeTab === 'preview' && selectedArtifact.type === 'react' && (
                    <div className="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                          GRPO vs PPO Multi-Task Return
                        </span>
                        <div className="flex items-center gap-1 bg-sunken p-1 rounded-[7px] border border-line text-[11.5px]">
                          {(
                            [
                              ['grpo', 'Reward'],
                              ['ppo', 'Pass %'],
                              ['kl', 'KL Div'],
                            ] as const
                          ).map(([k, lbl]) => (
                            <button
                              key={k}
                              onClick={() => setMetricView(k)}
                              className={`min-h-[32px] px-3 rounded-[5px] font-medium transition-colors ${
                                metricView === k ? 'bg-sage text-canvas' : 'text-ink-2 hover:text-ink'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                        <div className="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
                          <div className="font-mono text-[10.5px] uppercase text-ink-3">GRPO Policy</div>
                          <div className="font-mono text-[18px] sm:text-[22px] font-semibold text-sage sm:mt-1">
                            {metricView === 'grpo' ? '0.884' : metricView === 'ppo' ? '92.4%' : '0.024'}
                          </div>
                        </div>
                        <div className="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
                          <div className="font-mono text-[10.5px] uppercase text-ink-3">Baseline</div>
                          <div className="font-mono text-[18px] sm:text-[22px] font-semibold text-brass-ink sm:mt-1">
                            {metricView === 'grpo' ? '0.770' : metricView === 'ppo' ? '81.0%' : '0.049'}
                          </div>
                        </div>
                        <div className="p-3 rounded-[9px] border border-line bg-canvas flex sm:block items-center justify-between">
                          <div className="font-mono text-[10.5px] uppercase text-ink-3">KV State</div>
                          <div className="font-mono text-[13.5px] sm:text-[14px] font-semibold text-ink sm:mt-2 truncate">
                            bench:{metricView}
                          </div>
                        </div>
                      </div>

                      <div className="p-3 rounded-[9px] border border-line bg-canvas">
                        <svg viewBox="0 0 640 120" className="w-full h-[118px]" aria-hidden="true">
                          {[28, 60, 92].map((y) => (
                            <line key={y} x1="12" y1={y} x2="628" y2={y} stroke="var(--c-line)" strokeDasharray="3 4" />
                          ))}
                          {(metricView === 'grpo'
                            ? [36, 44, 52, 61, 69, 78, 86, 94, 99, 105]
                            : metricView === 'ppo'
                            ? [44, 52, 58, 66, 73, 81, 88, 93, 98, 104]
                            : [96, 88, 79, 71, 63, 55, 48, 41, 35, 29]
                          ).map((h, i) => {
                            const x = 24 + i * 60;
                            return (
                              <g key={i}>
                                <rect
                                  x={x}
                                  y={112 - h}
                                  width="36"
                                  height={h}
                                  rx="5"
                                  fill={i >= 7 ? 'var(--c-sage)' : 'var(--c-sage-soft)'}
                                  stroke="var(--c-sage-border)"
                                />
                                <circle cx={x + 18} cy={112 - h - 6} r="3" fill="#C8A96B" />
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </div>
                  )}

                  {activeTab === 'preview' && selectedArtifact.type === 'threejs' && (
                    <div className="rounded-[12px] border border-[#2D352E] bg-[#131A15] p-5 text-[#ECEAE3] relative overflow-hidden">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#98AC93]">
                          Three.js + R3F Sandbox Viewport
                        </span>
                        <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-[#1F2A20] border border-[#3E4C3B] text-[#C7D3C0]">
                          60 FPS · WebGL2 · OrbitControls
                        </span>
                      </div>

                      <svg viewBox="0 0 640 220" className="w-full h-[210px]" aria-hidden="true">
                        {/* Perspective Floor Grid */}
                        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                          <line
                            key={`h-${i}`}
                            x1={90 + i * 16}
                            y1={198 - i * 16}
                            x2={550 - i * 16}
                            y2={198 - i * 16}
                            stroke="#263329"
                            strokeWidth="1.2"
                          />
                        ))}
                        {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
                          <line
                            key={`v-${k}`}
                            x1={320 + k * 42}
                            y1={198}
                            x2={320 + k * 24}
                            y2={102}
                            stroke="#263329"
                            strokeWidth="1.2"
                          />
                        ))}
                        {/* Isometric Translucent Crystal Prism */}
                        <polygon points="320,34 404,78 320,122 236,78" fill="#55684F" fillOpacity="0.45" stroke="#98AC93" strokeWidth="2" />
                        <polygon points="236,78 320,122 320,186 236,142" fill="#2A352B" fillOpacity="0.72" stroke="#98AC93" strokeWidth="1.8" />
                        <polygon points="404,78 320,122 320,186 404,142" fill="#1D261F" fillOpacity="0.85" stroke="#C8A96B" strokeWidth="1.8" />
                        <line x1="320" y1="34" x2="320" y2="186" stroke="#C8A96B" strokeDasharray="4 4" strokeWidth="1.5" />
                        <circle cx="320" cy="34" r="5" fill="#C8A96B" />
                        {/* Axis Gizmo */}
                        <line x1="560" y1="176" x2="594" y2="176" stroke="#8FA28A" strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="560" y1="176" x2="560" y2="142" stroke="#C8A96B" strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="560" y1="176" x2="538" y2="192" stroke="#7C93A8" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    </div>
                  )}

                  {activeTab === 'preview' && selectedArtifact.type === 'mermaid' && (
                    <div className="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-5">
                      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                        Mermaid v11 · Cascading Access Control
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
                        {[
                          { tier: 'Workspace', role: 'Owner', bg: 'bg-sage-soft/65 border-[var(--c-sage-border)]' },
                          { tier: 'Private Project', role: 'Admin', bg: 'bg-brass-soft/65 border-brass-line' },
                          { tier: 'Category', role: 'Editor', bg: 'bg-canvas border-line' },
                          { tier: 'Artifact v2', role: 'Safe Agent', bg: 'bg-sage-soft border-[var(--c-sage-border)]' },
                        ].map((node) => (
                          <div key={node.tier} className={`p-4 rounded-[10px] border text-center ${node.bg}`}>
                            <div className="text-[13.5px] font-semibold text-ink">{node.tier}</div>
                            <div className="font-mono text-[11px] text-ink-3 mt-1">{node.role}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'preview' && selectedArtifact.type === 'tensorboard' && (
                    <div className="rounded-[12px] border border-line bg-raised p-5 flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                          TensorBoard Scalar Stream · Step 4,000
                        </span>
                        <span className="font-mono text-[11px] px-2.5 py-0.5 rounded bg-brass-soft text-brass-ink border border-brass-line">
                          step-4000.safetensors · R2 SigV4
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3.5 rounded-[9px] border border-line bg-canvas">
                          <div className="flex justify-between font-mono text-[11.5px] text-ink-2 mb-2">
                            <span>train/reward</span>
                            <span className="text-sage font-semibold">0.884</span>
                          </div>
                          <svg viewBox="0 0 280 90" className="w-full h-[90px]" aria-hidden="true">
                            <line x1="0" y1="30" x2="280" y2="30" stroke="var(--c-line)" strokeDasharray="3 4" />
                            <line x1="0" y1="60" x2="280" y2="60" stroke="var(--c-line)" strokeDasharray="3 4" />
                            <path
                              d="M 8 76 Q 70 68, 120 48 T 272 14"
                              fill="none"
                              stroke="var(--c-sage)"
                              strokeWidth="3"
                              strokeLinecap="round"
                            />
                          </svg>
                        </div>
                        <div className="p-3.5 rounded-[9px] border border-line bg-canvas">
                          <div className="flex justify-between font-mono text-[11.5px] text-ink-2 mb-2">
                            <span>train/kl_div</span>
                            <span className="text-brass-ink font-semibold">0.024</span>
                          </div>
                          <svg viewBox="0 0 280 90" className="w-full h-[90px]" aria-hidden="true">
                            <line x1="0" y1="30" x2="280" y2="30" stroke="var(--c-line)" strokeDasharray="3 4" />
                            <line x1="0" y1="60" x2="280" y2="60" stroke="var(--c-line)" strokeDasharray="3 4" />
                            <path
                              d="M 8 24 Q 70 58, 130 42 T 272 28"
                              fill="none"
                              stroke="#C8A96B"
                              strokeWidth="3"
                              strokeLinecap="round"
                            />
                          </svg>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'diff' && (
                    <div className="rounded-[12px] border border-line bg-raised overflow-hidden font-mono text-[12px] leading-[1.65]">
                      <div className="px-4 py-2 border-b border-line bg-sunken text-ink-2 flex items-center gap-2">
                        <GitCompare className="w-3.5 h-3.5 text-sage" aria-hidden="true" />
                        <span>v{Math.max(1, selectedArtifact.version - 1)} → v{selectedArtifact.version}</span>
                      </div>
                      <div className="divide-y divide-line/40 overflow-x-auto">
                        {selectedArtifact.diff.map((row, idx) => (
                          <div
                            key={idx}
                            className={`grid grid-cols-[34px_34px_20px_1fr] px-2 ${
                              row.kind === 'add'
                                ? 'bg-add text-add-ink'
                                : row.kind === 'del'
                                ? 'bg-del text-del-ink'
                                : 'text-ink-2'
                            }`}
                          >
                            <span aria-hidden="true" className="text-right pr-2 text-ink-3 select-none">{row.lineOld}</span>
                            <span aria-hidden="true" className="text-right pr-2 text-ink-3 select-none">{row.lineNew}</span>
                            <span aria-hidden="true" className="select-none font-semibold">
                              {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
                            </span>
                            <pre className="m-0 whitespace-pre">{row.text}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'code' && (
                    <div className="rounded-[12px] border border-line bg-raised overflow-hidden">
                      <div className="px-4 py-2 border-b border-line bg-sunken flex items-center justify-between">
                        <span className="font-mono text-[11.5px] text-ink-2">
                          {selectedArtifact.slug} · v{selectedArtifact.version}
                        </span>
                        <button
                          onClick={() => handleCopy('code', selectedArtifact.code.join('\n'))}
                          aria-label="Copy source code snippet"
                          className="min-h-[32px] px-2.5 rounded bg-raised border border-line text-[11.5px] font-mono text-ink-2 hover:text-ink inline-flex items-center gap-1"
                        >
                          {copiedCmd === 'code' ? (
                            <Check className="w-3 h-3 text-sage" aria-hidden="true" />
                          ) : (
                            <Copy className="w-3 h-3" aria-hidden="true" />
                          )}
                          {copiedCmd === 'code' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="p-3.5 font-mono text-[12px] leading-[1.6] overflow-x-auto">
                        {selectedArtifact.code.map((ln, idx) => (
                          <div key={idx} className="grid grid-cols-[32px_1fr] gap-3">
                            <span aria-hidden="true" className="text-right text-ink-3 select-none">
                              {idx + 1}
                            </span>
                            <pre className="m-0 text-ink whitespace-pre">{ln || ' '}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'state' && (
                    <div className="rounded-[12px] border border-line bg-raised overflow-hidden">
                      <div className="px-4 py-2 border-b border-line bg-sunken text-[11.5px] font-mono text-ink-2">
                        window.storage · Viewer Copy-on-Write Isolation
                      </div>
                      <table className="w-full text-left border-collapse text-[12.5px]">
                        <thead>
                          <tr className="border-b border-line text-ink-3 font-mono text-[11px] uppercase">
                            <th className="py-2.5 px-4 font-medium">Key</th>
                            <th className="py-2.5 px-4 font-medium">Value</th>
                            <th className="py-2.5 px-4 font-medium">Scope</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {selectedArtifact.storage.map((entry) => (
                            <tr key={entry.key}>
                              <td className="py-2.5 px-4 font-mono text-ink font-medium">{entry.key}</td>
                              <td className="py-2.5 px-4 font-mono text-ink-2">{entry.value}</td>
                              <td className="py-2.5 px-4 font-mono text-[11px] text-sage">{entry.scope}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4-Card Visual Bento Grid */}
        <section id="features" aria-labelledby="features-heading" className="border-t border-line bg-raised">
          <div className="max-w-[1120px] mx-auto px-5 sm:px-8 py-20">
            <div className="max-w-[540px]">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">
                How It Works
              </span>
              <h2 id="features-heading" className="font-serif text-[28px] sm:text-[38px] leading-[1.12] font-semibold text-ink m-0 mt-2">
                Built for multi-agent workflows
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Bento 1: Cross-Agent Version Timeline */}
              <article className="lg:col-span-7 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div className="rounded-[10px] border border-line bg-raised p-4 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style={{ backgroundColor: 'var(--ag-claude-bg)', color: 'var(--ag-claude-fg)' }}>
                      v1 · Claude
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-hidden="true" />
                    <span className="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style={{ backgroundColor: 'var(--ag-codex-bg)', color: 'var(--ag-codex-fg)' }}>
                      v2 · Codex +18 -4
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-hidden="true" />
                    <span className="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style={{ backgroundColor: 'var(--ag-agy-bg)', color: 'var(--ag-agy-fg)' }}>
                      v3 · Antigravity
                    </span>
                  </div>
                  <span className="font-mono text-[11px] px-2 py-1 rounded bg-brass-soft text-brass-ink border border-brass-line whitespace-nowrap">
                    index.md Wiki
                  </span>
                </div>

                <div>
                  <h3 className="text-[17px] font-semibold text-ink m-0">
                    Cross-Agent Version Timeline
                  </h3>
                  <p className="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">
                    Hand off visual work between assistants with immutable checkpoints, unified diffs, and 1-click rollback.
                  </p>
                </div>
              </article>

              {/* Bento 2: Safe Agent Scope Ceiling */}
              <article className="lg:col-span-5 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div className="rounded-[10px] border border-line bg-raised p-4 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    {['artifacts:read', 'artifacts:write', 'storage:write', 'tb:write'].map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">
                        <Check className="w-3 h-3" aria-hidden="true" />
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11]">
                    {['artifacts:delete', 'iam:share'].map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brass-soft text-brass-ink border border-brass-line">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-[17px] font-semibold text-ink m-0">
                    Safe Agent Scope Ceiling
                  </h3>
                  <p className="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">
                    Log in once via <code className="font-mono text-[12.5px]">myartifact login</code>; agents share your identity while destructive actions stay blocked.
                  </p>
                </div>
              </article>

              {/* Bento 3: Cascading RBAC & Batch Share */}
              <article className="lg:col-span-5 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div className="rounded-[10px] border border-line bg-raised p-4 flex items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded bg-sunken text-ink border border-line">
                      <FolderTree className="w-3.5 h-3.5 text-sage" aria-hidden="true" />
                      Workspace → Private Project
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                      <ShieldCheck className="w-3.5 h-3.5 text-sage" aria-hidden="true" />
                      <span>@acme.com + Share Links</span>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] px-2.5 py-1 rounded-full bg-sage text-canvas shrink-0">
                    Google OIDC
                  </span>
                </div>

                <div>
                  <h3 className="text-[17px] font-semibold text-ink m-0">
                    Cascading RBAC &amp; Batch Sharing
                  </h3>
                  <p className="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">
                    Grant roles across selected artifacts or folders for emails, groups, Google domains, or expiring links.
                  </p>
                </div>
              </article>

              {/* Bento 4: Local SQLite or $0/mo Cloud */}
              <article className="lg:col-span-7 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div className="rounded-[10px] border border-line bg-raised p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-[8px] border border-line bg-canvas flex items-center gap-2.5">
                    <Database className="w-4 h-4 text-sage shrink-0" aria-hidden="true" />
                    <div>
                      <div className="text-[12.5px] font-semibold text-ink">Local Offline Studio</div>
                      <div className="font-mono text-[11px] text-ink-3">SQLite FTS5 · WebSocket</div>
                    </div>
                  </div>
                  <div className="p-3 rounded-[8px] border border-[var(--c-sage-border)] bg-sage-soft/50 flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-sage shrink-0" aria-hidden="true" />
                    <div>
                      <div className="text-[12.5px] font-semibold text-ink">$0/mo Serverless Cloud</div>
                      <div className="font-mono text-[11px] text-ink-3">Vercel · Neon · R2 · ETag</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-[17px] font-semibold text-ink m-0">
                    Local SQLite or $0/mo Serverless Cloud
                  </h3>
                  <p className="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">
                    Run 100% locally on disk, or deploy statelessly on Vercel Hobby, Neon Postgres, and Cloudflare R2.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Clean Checkmark Comparison Table */}
        <section aria-labelledby="compare-heading" className="max-w-[920px] mx-auto px-5 sm:px-8 py-20">
          <div className="text-center mb-8">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">
              Comparison
            </span>
            <h2 id="compare-heading" className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-2">
              At a glance
            </h2>
          </div>

          <div className="rounded-[14px] border border-line bg-raised overflow-x-auto shadow-[0_6px_24px_rgba(30,36,32,0.05)]">
            <table className="w-full text-left border-collapse text-[13.5px] min-w-[560px]">
              <thead>
                <tr className="border-b border-line bg-canvas/70 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-3.5 px-5 font-medium">Capability</th>
                  <th className="py-3.5 px-4 font-semibold text-sage">MyArtifact</th>
                  <th className="py-3.5 px-4 font-medium">Chat Artifacts</th>
                  <th className="py-3.5 px-4 font-medium">Local Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="hover:bg-canvas/40 transition-colors">
                    <td className="py-3.5 px-5 font-medium text-ink">{row.label}</td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 font-medium text-sage">
                        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{row.myArtifact}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-ink-3">{row.chatLocked}</td>
                    <td className="py-3.5 px-4 text-ink-3">{row.rawFiles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Calm 5-Item FAQ */}
        <section id="faq" aria-labelledby="faq-heading" className="border-t border-line bg-raised">
          <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-20">
            <div className="text-center mb-8">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">
                FAQ
              </span>
              <h2 id="faq-heading" className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-2">
                Common questions
              </h2>
            </div>

            <div className="space-y-2.5">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-[11px] border border-line bg-canvas px-4 py-3.5 open:border-line-strong transition-colors"
                >
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-medium text-[14.5px] text-ink min-h-[32px]">
                    <span>{item.q}</span>
                    <ChevronDown className="w-4 h-4 text-ink-3 shrink-0 group-open:rotate-180 transition-transform" aria-hidden="true" />
                  </summary>
                  <p className="mt-2.5 mb-0 text-[13.5px] leading-relaxed text-ink-2">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Quiet Closing CTA */}
        <section className="max-w-[920px] mx-auto px-5 sm:px-8 py-16">
          <div className="rounded-[16px] border border-[var(--c-sage-border)] bg-sage-soft/50 px-6 py-10 text-center flex flex-col items-center gap-4">
            <h2 className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0">
              Start in 10 seconds.
            </h2>
            <p className="text-[14.5px] text-ink-2 m-0 max-w-[480px]">
              Run <code className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-raised border border-line">npx myartifact setup</code> locally or sign in with Google to share workspaces with your team.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              {renderPrimaryCta(true)}
            </div>
          </div>
        </section>
      </main>

      {/* Clean Single-Row Footer */}
      <footer className="border-t border-line bg-canvas">
        <div className="max-w-[1120px] mx-auto px-5 sm:px-8 py-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[12.5px] text-ink-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-[20px] h-[20px] rounded-[5px] overflow-hidden flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
            />
            <span>
              <strong className="text-ink">MyArtifact</strong> · MIT License
            </span>
          </div>

          <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-5">
            <a href="/signin" className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">
              Sign In
            </a>
            <a href="/auth/device" className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">
              CLI Device Flow
            </a>
            <a href="/llms.txt" className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">
              llms.txt
            </a>
            <a href="/sitemap.xml" className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">
              Sitemap
            </a>
            <a
              href="https://github.com/TannedCung/MyArtifact"
              target="_blank"
              rel="noopener noreferrer"
              className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};
