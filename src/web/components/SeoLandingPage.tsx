import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Atom,
  BookOpen,
  Check,
  ChevronDown,
  CodeXml,
  Copy,
  Database,
  ExternalLink,
  FolderTree,
  GitCompare,
  History,
  Lock,
  Moon,
  PenTool,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Users,
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

type ShowcaseTab = 'preview' | 'code' | 'diff' | 'storage';

interface DemoArtifact {
  id: string;
  slug: string;
  title: string;
  type: 'react' | 'mermaid' | 'tensorboard' | 'svg';
  projectPath: string;
  version: number;
  agent: 'claude-code' | 'codex' | 'antigravity' | 'watcher';
  agentLabel: string;
  agentBg: string;
  agentFg: string;
  agentDot: string;
  updatedAgo: string;
  summary: string;
  code: string[];
  diff: Array<{ kind: 'ctx' | 'del' | 'add'; lineOld: string; lineNew: string; text: string }>;
  storage: Array<{ key: string; value: string; scope: string }>;
}

const DEMO_ARTIFACTS: DemoArtifact[] = [
  {
    id: 'demo-eval',
    slug: 'rl-locomotion-bench',
    title: 'RL Locomotion Eval Suite',
    type: 'react',
    projectPath: 'robotics / benchmarks',
    version: 3,
    agent: 'claude-code',
    agentLabel: 'Claude Code',
    agentBg: 'var(--ag-claude-bg)',
    agentFg: 'var(--ag-claude-fg)',
    agentDot: 'var(--ag-claude-dot)',
    updatedAgo: '4m ago',
    summary: 'v3 · Added Recharts confidence interval & window.storage preset filter',
    code: [
      'import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";',
      'import { useEffect, useState } from "react";',
      '',
      'export default function LocomotionBench() {',
      '  const [metric, setMetric] = useState("reward");',
      '  useEffect(() => {',
      '    window.storage?.get("bench:metric").then((r) => r?.value && setMetric(r.value));',
      '  }, []);',
      '  return (',
      '    <section className="p-5 bg-canvas text-ink rounded-xl border border-line">',
      '      <header className="flex justify-between items-center mb-4">',
      '        <h2 className="font-semibold">GRPO vs PPO Policy Return</h2>',
      '        <button onClick={() => window.storage?.set("bench:metric", metric)}>Persist</button>',
      '      </header>',
      '      <ResponsiveContainer width="100%" height={220}>...',
    ],
    diff: [
      { kind: 'ctx', lineOld: '11', lineNew: '11', text: '<header className="flex justify-between items-center mb-4">' },
      { kind: 'del', lineOld: '12', lineNew: '', text: '  <h2 className="font-semibold">Policy Reward Snapshot</h2>' },
      { kind: 'add', lineOld: '', lineNew: '12', text: '  <h2 className="font-semibold">GRPO vs PPO Policy Return</h2>' },
      { kind: 'add', lineOld: '', lineNew: '13', text: '  <button onClick={() => window.storage?.set("bench:metric", metric)}>Persist</button>' },
      { kind: 'ctx', lineOld: '13', lineNew: '14', text: '</header>' },
      { kind: 'add', lineOld: '', lineNew: '15', text: '<ConfidenceBand lower={0.79} upper={0.91} />' },
    ],
    storage: [
      { key: 'bench:metric', value: '"reward"', scope: 'workspace' },
      { key: 'selected_env', value: '"Humanoid-v4"', scope: 'workspace' },
      { key: 'baseline_tag', value: '"ppo-clip-0.2"', scope: 'workspace' },
    ],
  },
  {
    id: 'demo-rbac',
    slug: 'cascading-rbac-topology',
    title: 'Cascading RBAC & Share Links',
    type: 'mermaid',
    projectPath: 'platform / iam',
    version: 2,
    agent: 'codex',
    agentLabel: 'OpenAI Codex',
    agentBg: 'var(--ag-codex-bg)',
    agentFg: 'var(--ag-codex-fg)',
    agentDot: 'var(--ag-codex-dot)',
    updatedAgo: '18m ago',
    summary: 'v2 · Added private project isolation override (inheritWorkspaceAcl = false)',
    code: [
      'flowchart LR',
      '  WS["Workspace Role (10..40)"] -->|inherit| PRJ["Project Scope"]',
      '  PRJ -->|inherit_workspace_acl = false| ISOLATED["Private Project"]',
      '  PRJ --> CAT["Category Folder"]',
      '  CAT --> ART["Artifact v1..vN"]',
      '  CLI["CLI / MCP Agent"] -.->|Safe Ceiling| ART',
      '  LINK["Share Token (anyone/domain)"] -.->|Read/Edit| ART',
    ],
    diff: [
      { kind: 'ctx', lineOld: '1', lineNew: '1', text: 'flowchart LR' },
      { kind: 'ctx', lineOld: '2', lineNew: '2', text: '  WS["Workspace Role (10..40)"] -->|inherit| PRJ["Project Scope"]' },
      { kind: 'add', lineOld: '', lineNew: '3', text: '  PRJ -->|inherit_workspace_acl = false| ISOLATED["Private Project"]' },
      { kind: 'add', lineOld: '', lineNew: '4', text: '  CLI["CLI / MCP Agent"] -.->|Safe Ceiling| ART' },
    ],
    storage: [
      { key: 'diagram:zoom', value: '"100%"', scope: 'workspace' },
      { key: 'highlight_node', value: '"Safe Ceiling"', scope: 'viewer CoW' },
    ],
  },
  {
    id: 'demo-tb',
    slug: 'qwen-grpo-run',
    title: 'Qwen-GRPO Training Curves',
    type: 'tensorboard',
    projectPath: 'rl-training / runs',
    version: 4,
    agent: 'antigravity',
    agentLabel: 'Antigravity',
    agentBg: 'var(--ag-agy-bg)',
    agentFg: 'var(--ag-agy-fg)',
    agentDot: 'var(--ag-agy-dot)',
    updatedAgo: '32m ago',
    summary: 'v4 · Logged step 4,000 scalars & SigV4 R2 checkpoint step-4000-best.safetensors',
    code: [
      '# Native MCP call from Antigravity / training worker:',
      'tensorboard_log_scalars({',
      '  slug: "qwen-grpo-run",',
      '  project: "rl-training",',
      '  step: 4000,',
      '  metrics: { "train/reward": 0.884, "train/kl_div": 0.024, "eval/pass@1": 0.742 }',
      '})',
      '',
      '# Direct SigV4 presigned PUT to Cloudflare R2 (bypasses 4.5MB serverless limit):',
      'tensorboard_save_checkpoint({',
      '  slug: "qwen-grpo-run",',
      '  name: "step-4000-best.safetensors",',
      '  isBest: true',
      '})',
    ],
    diff: [
      { kind: 'del', lineOld: '5', lineNew: '', text: '  step: 3200, metrics: { "train/reward": 0.812, "eval/pass@1": 0.691 }' },
      { kind: 'add', lineOld: '', lineNew: '5', text: '  step: 4000, metrics: { "train/reward": 0.884, "eval/pass@1": 0.742 }' },
      { kind: 'add', lineOld: '', lineNew: '11', text: '  name: "step-4000-best.safetensors", isBest: true' },
    ],
    storage: [
      { key: 'tb:smoothing', value: '0.65', scope: 'workspace' },
      { key: 'tb:pinned_ckpt', value: '"step-4000-best.safetensors"', scope: 'workspace' },
    ],
  },
  {
    id: 'demo-edge',
    slug: 'vercel-neon-topology',
    title: 'Serverless $0/mo Cloud Topology',
    type: 'svg',
    projectPath: 'infra / serverless',
    version: 2,
    agent: 'watcher',
    agentLabel: 'Watched file',
    agentBg: 'var(--ag-watcher-bg)',
    agentFg: 'var(--ag-watcher-fg)',
    agentDot: 'var(--ag-watcher-dot)',
    updatedAgo: '1h ago',
    summary: 'v2 · Updated stateless ETag /api/sync & R2 direct presigned path',
    code: [
      '<svg viewBox="0 0 640 280" xmlns="http://www.w3.org/2000/svg">',
      '  <!-- Cloudflare DNS -> Vercel CDN + api/index.js -> Neon -pooler + R2 -->',
      '  <rect x="24" y="96" width="144" height="72" rx="10" />',
      '  <rect x="236" y="42" width="168" height="72" rx="10" />',
      '  <rect x="236" y="158" width="168" height="72" rx="10" />',
      '  <rect x="468" y="42" width="148" height="72" rx="10" />',
      '  <rect x="468" y="158" width="148" height="72" rx="10" />',
      '</svg>',
    ],
    diff: [
      { kind: 'del', lineOld: '2', lineNew: '', text: '  <!-- Persistent /ws WebSocket + Postgres LISTEN -->' },
      { kind: 'add', lineOld: '', lineNew: '2', text: '  <!-- Stateless HTTP ETag /api/sync (304 Not Modified) + Neon -pooler -->' },
    ],
    storage: [
      { key: 'topology:env', value: '"vercel-hobby-sin1"', scope: 'workspace' },
      { key: 'poll_interval_ms', value: '5000', scope: 'workspace' },
    ],
  },
];

const FAQ_ITEMS = [
  {
    q: 'How is MyArtifact different from chat-locked Claude or GPT Artifacts?',
    a: 'Chat-locked artifacts vanish inside isolated chat threads and cannot be edited by other coding assistants. MyArtifact gives Claude Code, OpenAI Codex, Google Antigravity, and your local filesystem one shared visual workspace with immutable v1..vN checkpoints, unified diffs, full-text search, and persistent window.storage.',
  },
  {
    q: 'Can I run MyArtifact 100% offline without cloud accounts?',
    a: 'Yes. Running npx myartifact setup and myartifact serve stores all artifacts, versions, FTS5 search indexes, and window.storage entries locally in ~/.myartifact with zero required cloud accounts or telemetry.',
  },
  {
    q: 'How do local coding agents safely access my Cloud workspaces?',
    a: 'Run myartifact login --cloud https://myartifact.app once in your terminal via Google OIDC PKCE loopback or RFC 8628 device flow. By default, local CLI and MCP agents receive a delegated session bounded by a Safe Agent Scope Ceiling (read/write artifacts, storage, and TensorBoard only — destructive deletes and IAM sharing return 403 agent_scope_restricted unless you explicitly run myartifact login --elevate).',
  },
  {
    q: 'How does cascading RBAC and Batch Sharing work?',
    a: 'Roles (viewer, editor, admin, owner) cascade down Workspace -> Project -> Category -> Artifact, with support for private projects (inheritWorkspaceAcl = false). Batch Sharing lets owners apply roles across multiple selected artifacts, projects, or categories at once for email invites (auto-claimed on first verified Google login), Workspace Groups, verified Google hd domains, or expiring capability Share Links.',
  },
  {
    q: 'Can untrusted shared artifacts access another user’s workspace state?',
    a: 'No. Every interactive artifact executes inside an isolated sandboxed iframe with strict postMessage origin/source validation, sanitized SVG icons, and Viewer Copy-on-Write sessionStorage isolation so read-only viewers can interact with controls without mutating workspace storage.',
  },
  {
    q: 'What does it cost to self-host MyArtifact Cloud?',
    a: 'MyArtifact is MIT-licensed and architected for $0/month hosting on Vercel Hobby (stateless Node 22 functions using conditional ETag /api/sync instead of permanent WebSockets), Neon Free Serverless PostgreSQL, and Cloudflare R2 free tier for >4.5 MB model checkpoints.',
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
  const [metricView, setMetricView] = useState<'reward' | 'success' | 'kl'>('reward');
  const [copiedCmd, setCopiedCmd] = useState<'setup' | 'login' | 'code' | null>(null);

  const selectedArtifact = useMemo(
    () => DEMO_ARTIFACTS.find((a) => a.id === selectedId) || DEMO_ARTIFACTS[0],
    [selectedId]
  );

  const handleCopy = async (kind: 'setup' | 'login' | 'code', text: string) => {
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
      : 'h-[34px] px-3.5 text-[13px] rounded-[7px]';

    if (primaryCtaIsStudio) {
      return (
        <button
          onClick={onOpenStudio}
          className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)]`}
        >
          <span>{authenticated ? 'Open Studio' : 'Launch Local Studio'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      );
    }

    if (googleEnabled) {
      return (
        <a
          href={googleLoginHref}
          className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)] no-underline`}
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
            />
          </svg>
          <span>Continue with Google</span>
        </a>
      );
    }

    return (
      <button
        onClick={onOpenSignIn}
        className={`${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors`}
      >
        <span>Sign In to Cloud</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    );
  };

  return (
    <div id="top" className="min-h-screen bg-canvas text-ink selection:bg-[#C7D3C0] selection:text-[#1E2420]">
      {/* Top Sticky Navigation */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="max-w-[1160px] mx-auto px-5 sm:px-8 h-[60px] flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5 text-ink no-underline min-w-0">
            <span
              aria-hidden="true"
              className="w-[30px] h-[30px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.12)] [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
            />
            <span className="font-semibold text-[15px] tracking-tight text-ink">
              MyArtifact
            </span>
            <span className="hidden sm:inline-flex items-center font-mono text-[10.5px] uppercase tracking-[0.06em] px-1.5 py-[2px] rounded bg-sunken text-ink-3 border border-line">
              MIT · v1.0
            </span>
          </a>

          <nav aria-label="Primary sections" className="hidden md:flex items-center gap-6 text-[13px] text-ink-2">
            <a href="#showcase" className="hover:text-ink transition-colors no-underline">
              Live Studio
            </a>
            <a href="#agents" className="hover:text-ink transition-colors no-underline">
              Workflow
            </a>
            <a href="#features" className="hover:text-ink transition-colors no-underline">
              Capabilities
            </a>
            <a href="#rbac" className="hover:text-ink transition-colors no-underline">
              Cloud RBAC
            </a>
            <a href="#compare" className="hover:text-ink transition-colors no-underline">
              Compare
            </a>
            <a href="#faq" className="hover:text-ink transition-colors no-underline">
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
              {theme === 'night' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
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
        {/* Hero Section */}
        <section className="max-w-[1160px] mx-auto px-5 sm:px-8 pt-12 sm:pt-16 pb-10 sm:pb-14">
          <div className="max-w-[840px]">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sage-soft border border-[var(--c-sage-border)] text-[11.5px] font-mono uppercase tracking-[0.06em] text-sage mb-5">
              <span className="w-2 h-2 rounded-full bg-[var(--c-live-dot)]" />
              <span>Local-First &amp; Serverless Cloud · Model Context Protocol</span>
            </div>

            <h1 className="font-serif text-[36px] sm:text-[52px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink m-0">
              One visual artifact studio for{' '}
              <span className="text-sage">every coding agent</span> you run.
            </h1>

            <p className="mt-5 text-[16px] sm:text-[18px] leading-[1.6] text-ink-2 max-w-[740px]">
              Stop losing dashboards, 3D scenes, Mermaid architecture maps, and training curves inside
              chat threads. <strong>MyArtifact</strong> gives <strong>Claude Code</strong>,{' '}
              <strong>OpenAI Codex</strong>, and <strong>Google Antigravity</strong> one shared,
              sandboxed visual workbench with immutable <code className="font-mono text-[14px] px-1.5 py-0.5 rounded bg-sunken text-ink">v1→vN</code>{' '}
              diffs, persistent <code className="font-mono text-[14px] px-1.5 py-0.5 rounded bg-sunken text-ink">window.storage</code>, and cascading Google OIDC RBAC.
            </p>

            {/* Primary CTA + Copyable Quickstart Commands */}
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {renderPrimaryCta(true)}

              <a
                href="#showcase"
                className="h-[44px] px-4 rounded-[9px] border border-line-strong bg-raised hover:bg-sunken text-ink text-[13.5px] font-medium inline-flex items-center gap-2 transition-colors no-underline"
              >
                <span>Explore Interactive Studio</span>
                <ChevronDown className="w-4 h-4 text-ink-3" />
              </a>

              {isCloudMode && !authenticated && (
                <button
                  onClick={onOpenSignIn}
                  className="h-[44px] px-4 rounded-[9px] border border-line bg-canvas hover:bg-sunken text-ink-2 hover:text-ink text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  <Terminal className="w-4 h-4 text-ink-3" />
                  <span>CLI &amp; Device Sign-In</span>
                </button>
              )}

              {authenticated && userEmail && (
                <span className="text-[12.5px] text-ink-2 font-mono px-2.5 py-1.5 rounded-[7px] bg-sunken border border-line">
                  Signed in as {userEmail}
                </span>
              )}
            </div>

            {/* Dual Command Strip */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[780px]">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[10px] border border-line bg-raised shadow-[0_1px_2px_rgba(30,36,32,0.05)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Terminal className="w-4 h-4 text-sage shrink-0" />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      1 · Local Setup &amp; MCP Auto-Wire
                    </div>
                    <code className="font-mono text-[12.5px] text-ink truncate block">
                      npx myartifact setup
                    </code>
                  </div>
                </div>
                <button
                  onClick={() => handleCopy('setup', 'npx myartifact setup')}
                  aria-label="Copy npx myartifact setup command"
                  className="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-canvas hover:bg-sunken text-[11.5px] font-mono text-ink-2 inline-flex items-center gap-1 shrink-0 transition-colors"
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

              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[10px] border border-line bg-raised shadow-[0_1px_2px_rgba(30,36,32,0.05)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className="w-4 h-4 text-[var(--c-brass-icon)] shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      2 · Cloud Identity for Agents
                    </div>
                    <code className="font-mono text-[12.5px] text-ink truncate block">
                      myartifact login --cloud https://myartifact.app
                    </code>
                  </div>
                </div>
                <button
                  onClick={() =>
                    handleCopy('login', 'myartifact login --cloud https://myartifact.app')
                  }
                  aria-label="Copy myartifact login command"
                  className="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-canvas hover:bg-sunken text-[11.5px] font-mono text-ink-2 inline-flex items-center gap-1 shrink-0 transition-colors"
                >
                  {copiedCmd === 'login' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-sage" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Supported Agents & Run Badges */}
            <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 mr-1">
                Built for:
              </span>
              {[
                { label: 'Claude Code', bg: 'var(--ag-claude-bg)', fg: 'var(--ag-claude-fg)', dot: 'var(--ag-claude-dot)' },
                { label: 'OpenAI Codex', bg: 'var(--ag-codex-bg)', fg: 'var(--ag-codex-fg)', dot: 'var(--ag-codex-dot)' },
                { label: 'Google Antigravity', bg: 'var(--ag-agy-bg)', fg: 'var(--ag-agy-fg)', dot: 'var(--ag-agy-dot)' },
                { label: 'Dropzone Watcher', bg: 'var(--ag-watcher-bg)', fg: 'var(--ag-watcher-fg)', dot: 'var(--ag-watcher-dot)' },
              ].map((ag) => (
                <span
                  key={ag.label}
                  style={{ backgroundColor: ag.bg, color: ag.fg }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border border-line/70"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ag.dot }} />
                  {ag.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sunken text-ink-2 border border-line font-mono text-[11px]">
                10 MCP Tools · 7 Runtimes · $0/mo Serverless Ready
              </span>
            </div>
          </div>
        </section>

        {/* Interactive Moss Studio Showcase */}
        <section
          id="showcase"
          aria-labelledby="showcase-heading"
          className="max-w-[1160px] mx-auto px-5 sm:px-8 py-6 pb-14"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
                Interactive Product Preview
              </span>
              <h2 id="showcase-heading" className="font-serif text-[24px] sm:text-[28px] font-semibold text-ink m-0 mt-1">
                Inspect how agents collaborate inside the Moss Studio
              </h2>
            </div>
            <span className="text-[12.5px] text-ink-3 font-mono">
              Click any artifact row or inspector tab →
            </span>
          </div>

          <div className="rounded-[14px] border border-line-strong bg-raised shadow-[0_20px_48px_rgba(30,36,32,0.12)] overflow-hidden grid grid-cols-1 lg:grid-cols-[276px_1fr]">
            {/* Demo Studio Sidebar */}
            <aside className="bg-canvas border-b lg:border-b-0 lg:border-r border-line flex flex-col">
              <div className="h-[52px] px-4 flex items-center justify-between border-b border-line">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-[24px] h-[24px] rounded-[6px] overflow-hidden flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
                  />
                  <div>
                    <div className="font-semibold text-[13px] text-ink leading-tight">Studio Wiki</div>
                    <div className="text-[10.5px] text-[var(--c-live-ink)] flex items-center gap-1 font-mono">
                      <span className="w-[5px] h-[5px] rounded-full bg-[var(--c-live-dot)]" />
                      Cloud · Synced
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-sunken border border-line text-ink-3">
                  index.md
                </span>
              </div>

              <div className="p-2 flex flex-col gap-1">
                {DEMO_ARTIFACTS.map((item) => {
                  const isSel = item.id === selectedArtifact.id;
                  const TypeIcon =
                    item.type === 'react'
                      ? Atom
                      : item.type === 'mermaid'
                      ? Workflow
                      : item.type === 'tensorboard'
                      ? Activity
                      : PenTool;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full text-left p-2.5 rounded-[8px] grid grid-cols-[28px_1fr_auto] gap-2.5 items-center transition-colors ${
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
                        <TypeIcon className="w-[15px] h-[15px]" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-ink truncate">{item.title}</div>
                        <div className="text-[11px] text-ink-2 flex items-center gap-1.5 truncate mt-0.5">
                          <span
                            className="w-[6px] h-[6px] rounded-full shrink-0"
                            style={{ backgroundColor: item.agentDot }}
                          />
                          <span className="truncate">
                            {item.agentLabel} · {item.updatedAgo}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-[10.5px] px-1.5 py-[1px] rounded bg-brass-soft text-brass-ink border border-brass-line">
                        v{item.version}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-auto p-3 border-t border-line text-[11px] font-mono text-ink-3 flex items-center justify-between">
                <span>⌘K Command Palette</span>
                <span>FTS5 + Backlinks</span>
              </div>
            </aside>

            {/* Demo Studio Main Pane */}
            <div className="flex flex-col min-w-0 bg-raised">
              {/* Top Inspector Header */}
              <div className="px-5 py-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-[16px] font-semibold text-ink">
                      {selectedArtifact.title}
                    </h3>
                    <span className="font-mono text-[11px] px-2 py-[1px] rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">
                      {selectedArtifact.projectPath}
                    </span>
                    <span
                      style={{
                        backgroundColor: selectedArtifact.agentBg,
                        color: selectedArtifact.agentFg,
                      }}
                      className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-[1px] rounded-full"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: selectedArtifact.agentDot }}
                      />
                      {selectedArtifact.agentLabel}
                    </span>
                  </div>
                  <p className="m-0 mt-1 text-[12px] text-ink-3 truncate">
                    {selectedArtifact.summary}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-[28px] px-2.5 rounded-[6px] border border-brass-line bg-brass-soft text-brass-ink font-mono text-[11.5px] font-medium inline-flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    v{selectedArtifact.version} LATEST
                  </span>
                  <div className="flex items-center gap-1 rounded-[7px] bg-sunken p-1 border border-line flex-wrap">
                    {(
                      [
                        ['preview', 'Preview'],
                        ['code', 'Code'],
                        ['diff', 'Diff'],
                        ['storage', 'window.storage'],
                      ] as const
                    ).map(([tabId, label]) => (
                      <button
                        key={tabId}
                        onClick={() => setActiveTab(tabId)}
                        className={`min-h-[34px] px-3 rounded-[5px] text-[12px] font-medium transition-colors ${
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
              </div>

              {/* Tab Content */}
              <div className="p-5 min-h-[340px] flex flex-col justify-between bg-canvas/35">
                {activeTab === 'preview' && selectedArtifact.type === 'react' && (
                  <div className="rounded-[10px] border border-line bg-raised p-5 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                          Interactive React Sandbox · Recharts + window.storage
                        </div>
                        <div className="text-[15px] font-semibold text-ink mt-0.5">
                          GRPO vs PPO Multi-Task Locomotion Suite
                        </div>
                      </div>
                      <div className="flex items-center gap-1 bg-sunken p-1 rounded-[7px] border border-line text-[11.5px]">
                        {(
                          [
                            ['reward', 'Reward'],
                            ['success', 'Success %'],
                            ['kl', 'KL Stability'],
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

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-[8px] border border-line bg-canvas">
                        <div className="font-mono text-[10.5px] uppercase text-ink-3">GRPO Policy</div>
                        <div className="font-mono text-[22px] font-semibold text-sage mt-1">
                          {metricView === 'reward' ? '0.884' : metricView === 'success' ? '92.4%' : '0.024'}
                        </div>
                        <div className="text-[11px] text-[var(--c-live-ink)] mt-0.5">
                          +14.8% vs baseline
                        </div>
                      </div>
                      <div className="p-3 rounded-[8px] border border-line bg-canvas">
                        <div className="font-mono text-[10.5px] uppercase text-ink-3">PPO Clip 0.2</div>
                        <div className="font-mono text-[22px] font-semibold text-brass-ink mt-1">
                          {metricView === 'reward' ? '0.770' : metricView === 'success' ? '81.0%' : '0.049'}
                        </div>
                        <div className="text-[11px] text-ink-3 mt-0.5">v1 authored by Codex</div>
                      </div>
                      <div className="p-3 rounded-[8px] border border-line bg-canvas">
                        <div className="font-mono text-[10.5px] uppercase text-ink-3">Persisted Preset</div>
                        <div className="font-mono text-[14px] font-semibold text-ink mt-2">
                          bench:metric = "{metricView}"
                        </div>
                        <div className="text-[11px] text-ink-3 mt-1">Synced to artifact_kv_store</div>
                      </div>
                    </div>

                    {/* Crisp Bar + Trend Chart */}
                    <div className="p-3 rounded-[8px] border border-line bg-canvas">
                      <svg viewBox="0 0 640 120" className="w-full h-[112px]" role="img" aria-label="Sample benchmark chart">
                        {[25, 55, 85].map((y) => (
                          <line key={y} x1="12" y1={y} x2="628" y2={y} stroke="var(--c-line)" strokeDasharray="3 4" />
                        ))}
                        {(metricView === 'reward'
                          ? [38, 44, 52, 60, 68, 76, 84, 92, 98, 102]
                          : metricView === 'success'
                          ? [46, 51, 59, 64, 72, 79, 86, 91, 96, 104]
                          : [92, 86, 78, 70, 62, 54, 48, 42, 36, 30]
                        ).map((h, i) => {
                          const x = 24 + i * 60;
                          return (
                            <g key={i}>
                              <rect
                                x={x}
                                y={110 - h}
                                width="36"
                                height={h}
                                rx="5"
                                fill={i >= 7 ? 'var(--c-sage)' : 'var(--c-sage-soft)'}
                                stroke="var(--c-sage-border)"
                              />
                              <circle cx={x + 18} cy={110 - h - 6} r="3" fill="#C8A96B" />
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                )}

                {activeTab === 'preview' && selectedArtifact.type === 'mermaid' && (
                  <div className="rounded-[10px] border border-line bg-raised p-5 flex flex-col gap-4">
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                      Mermaid v11 Architecture Flow · Rendered Live
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                      {[
                        { badge: 'RANK 10..40', title: 'Workspace RBAC', desc: 'Google OIDC + optional hd domain lock', cls: 'border-[var(--c-sage-border)] bg-sage-soft/60' },
                        { badge: 'INHERIT OR ISOLATE', title: 'Project Scope', desc: 'inheritWorkspaceAcl = false for private projects', cls: 'border-brass-line bg-brass-soft/60' },
                        { badge: 'PREFIX MATCH', title: 'Category Folder', desc: 'Grants cascade cleanly down sub-paths', cls: 'border-line bg-canvas' },
                        { badge: 'SAFE CEILING', title: 'Artifact v1..vN', desc: 'Agents blocked from deletes & IAM edits', cls: 'border-[var(--c-sage-border)] bg-sage-soft' },
                      ].map((n, idx) => (
                        <div key={idx} className={`p-3.5 rounded-[10px] border ${n.cls}`}>
                          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                            {n.badge}
                          </div>
                          <div className="text-[13.5px] font-semibold text-ink mt-1">{n.title}</div>
                          <p className="m-0 mt-1 text-[11.5px] text-ink-2 leading-snug">{n.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'preview' && selectedArtifact.type === 'tensorboard' && (
                  <div className="rounded-[10px] border border-line bg-raised p-5 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                          TensorBoard Scalar Stream + R2 SigV4 Checkpoint
                        </div>
                        <div className="text-[15px] font-semibold text-ink mt-0.5">
                          qwen-grpo-run · step 4,000 / 4,000
                        </div>
                      </div>
                      <span className="font-mono text-[11.5px] px-2.5 py-1 rounded-[6px] bg-brass-soft text-brass-ink border border-brass-line">
                        best: step-4000-best.safetensors (14.2 GB)
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-[8px] border border-line bg-canvas">
                        <div className="flex justify-between font-mono text-[11px] text-ink-2 mb-2">
                          <span>train/reward</span>
                          <span className="text-sage font-semibold">0.884</span>
                        </div>
                        <svg viewBox="0 0 280 80" className="w-full h-[76px]" aria-label="Reward curve">
                          <polyline
                            fill="none"
                            stroke="var(--c-sage)"
                            strokeWidth="2.5"
                            points="8,68 48,60 88,54 128,44 168,36 208,24 248,16 272,12"
                          />
                        </svg>
                      </div>
                      <div className="p-3.5 rounded-[8px] border border-line bg-canvas">
                        <div className="flex justify-between font-mono text-[11px] text-ink-2 mb-2">
                          <span>train/kl_div</span>
                          <span className="text-brass-ink font-semibold">0.024</span>
                        </div>
                        <svg viewBox="0 0 280 80" className="w-full h-[76px]" aria-label="KL divergence curve">
                          <polyline
                            fill="none"
                            stroke="#C8A96B"
                            strokeWidth="2.5"
                            points="8,22 48,48 88,42 128,38 168,31 208,29 248,26 272,24"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'preview' && selectedArtifact.type === 'svg' && (
                  <div className="rounded-[10px] border border-line bg-raised p-5 flex flex-col gap-3">
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                      SVG Topology Artboard · Vercel Hobby ($0/mo) + Neon Free + R2
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
                      <div className="p-3.5 rounded-[8px] border border-line bg-canvas">
                        <div className="font-semibold text-ink">1 · Edge Static CDN</div>
                        <p className="m-0 mt-1 text-ink-2">
                          React SPA + OG image + robots/sitemap served globally at 0 function invocations.
                        </p>
                      </div>
                      <div className="p-3.5 rounded-[8px] border border-[var(--c-sage-border)] bg-sage-soft/50">
                        <div className="font-semibold text-ink">2 · Stateless Functions</div>
                        <p className="m-0 mt-1 text-ink-2">
                          <code className="font-mono">api/index.js</code> derives keys from 1 secret &amp; serves <code className="font-mono">/api/sync</code> 304 ETags.
                        </p>
                      </div>
                      <div className="p-3.5 rounded-[8px] border border-brass-line bg-brass-soft/50">
                        <div className="font-semibold text-ink">3 · Neon + R2 Blobs</div>
                        <p className="m-0 mt-1 text-ink-2">
                          Pooled Postgres scale-to-zero (`max: 3`) + direct R2 SigV4 URLs for checkpoints &gt;4.5 MB.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'code' && (
                  <div className="rounded-[10px] border border-line bg-raised overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-line bg-sunken flex items-center justify-between">
                      <span className="font-mono text-[11px] text-ink-2">
                        {selectedArtifact.slug} · v{selectedArtifact.version}
                      </span>
                      <button
                        onClick={() => handleCopy('code', selectedArtifact.code.join('\n'))}
                        aria-label="Copy demo artifact source code"
                        className="min-h-[32px] px-2.5 rounded bg-raised border border-line text-[11px] font-mono text-ink-2 hover:text-ink inline-flex items-center gap-1"
                      >
                        {copiedCmd === 'code' ? <Check className="w-3 h-3 text-sage" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                        {copiedCmd === 'code' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="p-3 font-mono text-[12px] leading-[1.6] overflow-x-auto">
                      {selectedArtifact.code.map((ln, idx) => (
                        <div key={idx} className="grid grid-cols-[36px_1fr] gap-3">
                          <span aria-hidden="true" className="text-right text-ink-3 select-none">{idx + 1}</span>
                          <pre className="m-0 text-ink whitespace-pre">{ln || ' '}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'diff' && (
                  <div className="rounded-[10px] border border-line bg-raised overflow-hidden font-mono text-[12px] leading-[1.6]">
                    <div className="px-3.5 py-2 border-b border-line bg-sunken text-ink-2 flex items-center gap-2">
                      <GitCompare className="w-3.5 h-3.5 text-sage" aria-hidden="true" />
                      <span>
                        Comparing v{Math.max(1, selectedArtifact.version - 1)} → v{selectedArtifact.version}
                      </span>
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

                {activeTab === 'storage' && (
                  <div className="rounded-[10px] border border-line bg-raised overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-line bg-sunken text-[11.5px] font-mono text-ink-2 flex items-center justify-between">
                      <span>window.storage · SQLite / Postgres KV</span>
                      <span className="text-ink-3">Viewer Copy-on-Write Protected</span>
                    </div>
                    <table className="w-full text-left border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-b border-line text-ink-3 font-mono text-[11px] uppercase">
                          <th className="py-2 px-3.5 font-medium">Key</th>
                          <th className="py-2 px-3.5 font-medium">Value (JSON / String)</th>
                          <th className="py-2 px-3.5 font-medium">Isolation Scope</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {selectedArtifact.storage.map((entry) => (
                          <tr key={entry.key}>
                            <td className="py-2.5 px-3.5 font-mono text-ink font-medium">{entry.key}</td>
                            <td className="py-2.5 px-3.5 font-mono text-ink-2">{entry.value}</td>
                            <td className="py-2.5 px-3.5 font-mono text-[11px] text-sage">{entry.scope}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Footnote inside preview frame */}
                <div className="mt-3 pt-3 border-t border-line/70 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-3 font-mono">
                  <span>Exportable as standalone single-file HTML (`?version={selectedArtifact.version}&amp;download=1`)</span>
                  <span>Zero-trust sandboxed iframe · strict postMessage origin check</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3-Step Multi-Agent Workflow */}
        <section id="agents" aria-labelledby="agents-heading" className="border-y border-line bg-raised">
          <div className="max-w-[1160px] mx-auto px-5 sm:px-8 py-14">
            <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
              Cross-Assistant Continuity
            </span>
            <h2 id="agents-heading" className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-1 max-w-[680px]">
              Switch agents mid-task without starting over
            </h2>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  step: '01 · SETUP ONCE',
                  title: 'Wire Claude Code, Codex & Antigravity',
                  body: 'Run npx myartifact setup to register .mcp.json and native skill guides across your coding assistants — or point agents at your cloud URL via MYARTIFACT_CLOUD_URL.',
                  code: 'npx myartifact setup && myartifact serve',
                },
                {
                  step: '02 · ITERATE TOGETHER',
                  title: 'Versioned handoffs in an LLM Wiki',
                  body: 'Claude Code scaffolds a v1 dashboard, Codex edits layout spacing into v2, and Antigravity attaches RL scalars to v3 — linked together via [[wiki-links]] and index.md.',
                  code: 'artifact_create -> artifact_update -> artifact_wiki_index',
                },
                {
                  step: '03 · LOGIN ONCE & SHARE',
                  title: 'Cloud identity with Safe Agent Ceiling',
                  body: 'Run myartifact login once via Google OIDC. Local MCP tools inherit your RBAC permissions while blocking accidental deletes or IAM changes unless --elevate is set.',
                  code: 'myartifact login --cloud https://myartifact.app',
                },
              ].map((card) => (
                <article
                  key={card.step}
                  className="p-5 rounded-[12px] border border-line bg-canvas flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.07em] text-brass-ink">
                      {card.step}
                    </div>
                    <h3 className="text-[16px] font-semibold text-ink m-0 mt-2">{card.title}</h3>
                    <p className="text-[13.5px] leading-relaxed text-ink-2 mt-2 mb-0">{card.body}</p>
                  </div>
                  <code className="font-mono text-[11.5px] px-2.5 py-2 rounded-[7px] bg-raised border border-line text-ink truncate block">
                    {card.code}
                  </code>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 8-Pillar Capabilities Grid */}
        <section id="features" aria-labelledby="features-heading" className="max-w-[1160px] mx-auto px-5 sm:px-8 py-14">
          <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
            Full Studio &amp; Platform Capabilities
          </span>
          <h2 id="features-heading" className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-1">
            Everything needed from localhost prototype to team cloud
          </h2>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                Icon: Atom,
                title: '7 Live Sandboxed Runtimes',
                desc: 'Preloaded React 19, Tailwind, Recharts, Lucide, Three.js / R3F, Mermaid 11, Markdown/KaTeX, SVG, HTML, and TensorBoard.',
              },
              {
                Icon: GitCompare,
                title: 'Immutable Versions & Diffs',
                desc: 'Every agent update writes a permanent checkpoint (v1, v2, v3) with collapsible unified code diffs and instant 1-click rollback.',
              },
              {
                Icon: Database,
                title: 'Safe window.storage State',
                desc: 'Interactive artifacts persist KV state across reloads. Read-only viewers test interactions in an isolated Copy-on-Write layer.',
              },
              {
                Icon: BookOpen,
                title: 'Karpathy-Pattern LLM Wiki',
                desc: 'Auto-synthesizes project / category folders, index.md, log.md, FTS5/Postgres full-text search, and [[wiki-links]] backlinks.',
              },
              {
                Icon: Activity,
                title: 'TensorBoard & S3 Checkpoints',
                desc: 'Stream .tfevents scalar series live and upload multi-GB .safetensors/.pt checkpoints directly via SigV4 pre-signed R2/S3 URLs.',
              },
              {
                Icon: FolderTree,
                title: 'Cascading Cloud RBAC',
                desc: 'Roles cascade Workspace -> Project -> Category -> Artifact with support for isolated private projects and expiring grants.',
              },
              {
                Icon: Share2,
                title: 'Batch Sharing & Links',
                desc: 'Share batches of artifacts or entire folders with Google emails (auto-claimed pending invites), groups, hd domains, or share links.',
              },
              {
                Icon: Sparkles,
                title: '$0/mo Serverless Architecture',
                desc: 'Runs statelessly on Vercel Hobby + Neon Free Postgres + Cloudflare R2 using conditional ETag HTTP sync instead of open WebSockets.',
              },
            ].map(({ Icon, title, desc }) => (
              <article
                key={title}
                className="p-4.5 rounded-[12px] border border-line bg-raised hover:border-line-strong transition-colors flex flex-col gap-2.5"
              >
                <span className="w-[34px] h-[34px] rounded-[8px] bg-sage-soft border border-[var(--c-sage-border)] text-sage flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </span>
                <h3 className="text-[14.5px] font-semibold text-ink m-0">{title}</h3>
                <p className="text-[13px] leading-relaxed text-ink-2 m-0">{desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Cloud RBAC & Safe Agent Governance Section */}
        <section id="rbac" aria-labelledby="rbac-heading" className="border-y border-line bg-raised">
          <div className="max-w-[1160px] mx-auto px-5 sm:px-8 py-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-6">
              <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
                Zero-Trust Multi-Tenant Security
              </span>
              <h2 id="rbac-heading" className="font-serif text-[26px] sm:text-[32px] font-semibold text-ink m-0 mt-1">
                Smooth permissions for teams. Strict ceilings for autonomous agents.
              </h2>
              <p className="text-[14.5px] leading-relaxed text-ink-2 mt-3">
                Sign in with Google OIDC on the web (`__Host-ma_session` + CSRF tokens) or run{' '}
                <code className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-canvas border border-line">
                  myartifact login
                </code>{' '}
                once locally. Every CLI call and MCP tool inherits your exact Google identity with dual-attribution audit logging (`actorEmail` + `viaAgent`).
              </p>

              <ul className="mt-5 space-y-2.5 text-[13.5px] text-ink-2 list-none p-0 m-0">
                {[
                  'Domain-spoofing guard validates email_verified: true + Google OIDC hd claims.',
                  '30s refresh-token rotation grace window + replay detection revokes compromised CLI sessions.',
                  'Batch Sharing queues pending_email invites claimed automatically on first Google login.',
                ].map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-sage shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-[12px] border border-[var(--c-sage-border)] bg-sage-soft/50">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-sage">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Default Agent Ceiling</span>
                </div>
                <p className="text-[12px] text-ink-2 mt-1.5 mb-3">
                  Granted by <code className="font-mono">myartifact login</code> for Claude Code, Codex &amp; Antigravity:
                </p>
                <div className="space-y-1.5 font-mono text-[11.5px]">
                  {[
                    ['artifacts:read', 'Search & fetch versions'],
                    ['artifacts:write', 'Create & iterate v1..vN'],
                    ['storage:write', 'Update widget KV state'],
                    ['tb:write', 'Stream TensorBoard runs'],
                  ].map(([scope, desc]) => (
                    <div key={scope} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-raised border border-line">
                      <span className="text-ink font-medium">{scope}</span>
                      <span className="text-ink-3 text-[10.5px] truncate">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-[12px] border border-brass-line bg-brass-soft/45 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-brass-ink">
                    <Lock className="w-4 h-4" />
                    <span>Blocked Without --elevate</span>
                  </div>
                  <p className="text-[12px] text-ink-2 mt-1.5 mb-3">
                    Protected human-only operations return <code className="font-mono">403 agent_scope_restricted</code>:
                  </p>
                  <div className="space-y-1.5 font-mono text-[11.5px]">
                    {[
                      ['artifacts:delete', 'Destructive deletion'],
                      ['iam:share', 'Batch grants & share links'],
                      ['workspace:admin', 'Groups & private projects'],
                    ].map(([scope, desc]) => (
                      <div key={scope} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-raised border border-line">
                        <span className="text-danger-ink font-medium">{scope}</span>
                        <span className="text-ink-3 text-[10.5px] truncate">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-brass-line/60 font-mono text-[11px] text-brass-ink">
                  Use `myartifact login --elevate` for 24h admin CLI
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section id="compare" aria-labelledby="compare-heading" className="max-w-[1160px] mx-auto px-5 sm:px-8 py-14">
          <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
            Architecture Comparison
          </span>
          <h2 id="compare-heading" className="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-1">
            Why teams replace ad-hoc local previews and chat sandboxes
          </h2>

          <div className="mt-7 rounded-[12px] border border-line bg-raised overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px] min-w-[680px]">
              <thead>
                <tr className="border-b border-line bg-sunken/70 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-2">
                  <th className="py-3 px-4 font-semibold">Capability</th>
                  <th className="py-3 px-4 font-semibold text-sage">MyArtifact (Local + Cloud)</th>
                  <th className="py-3 px-4 font-semibold">Chat-Locked Web Artifacts</th>
                  <th className="py-3 px-4 font-semibold">Raw Local Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  ['Shared across Claude Code, Codex & Antigravity', 'Native MCP + CLI + Watcher', 'Locked per chat session', 'Manual copy-paste'],
                  ['Live React / Three.js / Mermaid / KaTeX Sandbox', 'Built-in multi-runtime iframe', 'React/HTML only', 'Requires Vite per folder'],
                  ['Immutable v1..vN Checkpoints & Code Diffs', 'Built-in timeline + rollback', 'Overwritten in chat stream', 'Requires manual git commits'],
                  ['Persistent window.storage & Viewer Isolation', 'SQLite/Postgres + CoW isolation', 'Ephemeral session only', 'No built-in bridge'],
                  ['LLM Wiki (index.md, log.md & FTS search)', 'Automatic synthesis & backlinks', 'None', 'Manual scripting'],
                  ['Google OIDC RBAC & Batch Sharing', 'Cascading 4-level RBAC + Links', 'All-or-nothing public link', 'None'],
                  ['Agent Scope Ceiling & Audit Attribution', 'Delegated scopes + viaAgent log', 'Not applicable', 'Unrestricted shell access'],
                ].map(([cap, ma, chat, raw]) => (
                  <tr key={cap} className="hover:bg-canvas/50 transition-colors">
                    <td className="py-3 px-4 font-medium text-ink">{cap}</td>
                    <td className="py-3 px-4 text-sage font-medium">{ma}</td>
                    <td className="py-3 px-4 text-ink-3">{chat}</td>
                    <td className="py-3 px-4 text-ink-3">{raw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ Accordion Section */}
        <section id="faq" aria-labelledby="faq-heading" className="border-t border-line bg-raised">
          <div className="max-w-[920px] mx-auto px-5 sm:px-8 py-14">
            <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
              Frequently Asked Questions
            </span>
            <h2 id="faq-heading" className="font-serif text-[26px] sm:text-[32px] font-semibold text-ink m-0 mt-1">
              Technical answers for engineers and AI teams
            </h2>

            <div className="mt-7 space-y-3">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-[10px] border border-line bg-canvas p-4 open:border-line-strong transition-colors"
                >
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-semibold text-[14.5px] text-ink">
                    <span>{item.q}</span>
                    <ChevronDown className="w-4 h-4 text-ink-3 shrink-0 group-open:rotate-180 transition-transform" />
                  </summary>
                  <p className="mt-3 mb-0 text-[13.5px] leading-relaxed text-ink-2">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA Card */}
        <section className="max-w-[1160px] mx-auto px-5 sm:px-8 py-12">
          <div className="rounded-[16px] border border-[var(--c-sage-border)] bg-sage-soft/55 p-7 sm:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.07em] text-sage">
                Open Source · MIT License
              </div>
              <h2 className="font-serif text-[24px] sm:text-[30px] font-semibold text-ink m-0 mt-1">
                Give your coding agents a persistent visual canvas today.
              </h2>
              <p className="text-[14px] text-ink-2 mt-2 mb-0 max-w-[600px]">
                Start locally with <code className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-raised border border-line">npx myartifact setup</code> or sign in to MyArtifact Cloud with Google to collaborate safely across projects.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {renderPrimaryCta(true)}
              <a
                href="/llms.txt"
                className="h-[44px] px-4 rounded-[9px] border border-line-strong bg-raised hover:bg-sunken text-ink text-[13px] font-mono inline-flex items-center gap-1.5 transition-colors no-underline"
              >
                <CodeXml className="w-4 h-4 text-ink-3" />
                <span>llms.txt</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Semantic Footer */}
      <footer className="border-t border-line bg-canvas">
        <div className="max-w-[1160px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[12.5px] text-ink-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="w-[22px] h-[22px] rounded-[5px] overflow-hidden flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
            />
            <span>
              <strong className="text-ink">MyArtifact</strong> · MIT License · Open-Source Visual Studio &amp; MCP Server
            </span>
          </div>

          <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-4">
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
              className="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center gap-1"
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              <span>GitHub</span>
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};
