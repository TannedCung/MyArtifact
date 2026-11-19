import { MYARTIFACT_LOGO_SVG } from '../core/brand-logo.js';
import {
  AGENT_BOOTSTRAP_PROMPT,
  DEMO_ARTIFACTS,
  STAGE_SVG,
  escapeHtml,
  renderStageHtml,
  type DemoArtifact,
  type SeoLandingRenderOptions,
} from './seo-landing-dom.js';

const COMPARISON_ROWS: Array<{
  label: string;
  myArtifact: string;
  chatLocked: string;
  rawFiles: string;
}> = [
  {
    label: 'Shared across Claude Code, Codex & Antigravity',
    myArtifact: 'MCP + CLI',
    chatLocked: 'Per-chat only',
    rawFiles: 'Manual copy',
  },
  {
    label: 'React, Three.js, Mermaid, KaTeX & TensorBoard',
    myArtifact: '7 runtimes',
    chatLocked: 'Partial',
    rawFiles: 'Manual setup',
  },
  {
    label: 'Immutable versions, diffs & window.storage',
    myArtifact: 'Built-in',
    chatLocked: 'Ephemeral',
    rawFiles: 'Manual git',
  },
  {
    label: 'Google OIDC cascading RBAC & batch sharing',
    myArtifact: '4-tier ACL',
    chatLocked: 'Public link',
    rawFiles: 'None',
  },
  {
    label: '100% offline local mode + $0/mo cloud deploy',
    myArtifact: 'MIT Open Source',
    chatLocked: 'Cloud only',
    rawFiles: 'Local only',
  },
];

const FAQ_ITEMS = [
  {
    q: 'How is MyArtifact different from chat-locked Claude or GPT Artifacts?',
    a: 'MyArtifact gives Claude Code, OpenAI Codex, and Google Antigravity one persistent visual workspace instead of trapping UI previews inside individual chat threads.',
  },
  {
    q: 'Do I need to run a local server to use MyArtifact Cloud?',
    a: 'No. MyArtifact Cloud hosts the studio, Postgres search, and R2 checkpoints for you—just install the CLI (npm i -g github:TannedCung/MyArtifact) and run myartifact login && myartifact setup so MCP tools publish to Cloud. (100% offline SQLite mode is also available via myartifact serve.)',
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

const RENDER_SVG = {
  arrowRight: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  chevronDown: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  externalLink: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
  terminal: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`,
  atom: (cls = 'w-[15px] h-[15px]') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg>`,
  box: (cls = 'w-[15px] h-[15px]') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  workflow: (cls = 'w-[15px] h-[15px]') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>`,
  activity: (cls = 'w-[15px] h-[15px]') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>`,
  lock: (cls = 'w-3 h-3') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  folderTree: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.9-.55H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/></svg>`,
  shieldCheck: (cls = 'w-3.5 h-3.5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
  database: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
  sparkles: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`,
  user: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  bot: (cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
  google: (cls = 'w-4 h-4 shrink-0') =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"/></svg>`,
};

function getArtifactIcon(type: DemoArtifact['type']): string {
  if (type === 'react') return RENDER_SVG.atom();
  if (type === 'threejs') return RENDER_SVG.box();
  if (type === 'mermaid') return RENDER_SVG.workflow();
  return RENDER_SVG.activity();
}

function renderPrimaryCtaHtml(opts: SeoLandingRenderOptions, large: boolean): string {
  const sizeCls = large
    ? 'h-[44px] px-5 text-[14px] rounded-[9px]'
    : 'h-[36px] px-3.5 text-[13px] rounded-[7px]';
  const primaryCtaIsStudio = !opts.isCloudMode || opts.authenticated;

  if (primaryCtaIsStudio) {
    const label = opts.authenticated ? 'Open Studio' : 'Launch Studio';
    return `<button type="button" data-ma-action="open-studio" class="${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)] whitespace-nowrap shrink-0"><span>${label}</span>${RENDER_SVG.arrowRight()}</button>`;
  }

  if (opts.googleEnabled) {
    const inner = large
      ? '<span>Continue with Google</span>'
      : '<span class="hidden sm:inline">Continue with Google</span><span class="sm:hidden">Sign in</span>';
    return `<a href="/api/auth/google/login?next=%2F" class="${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors shadow-[0_1px_2px_rgba(30,36,32,0.10)] no-underline whitespace-nowrap shrink-0">${RENDER_SVG.google()}${inner}</a>`;
  }

  return `<button type="button" data-ma-action="open-signin" class="${sizeCls} bg-sage hover:bg-sage-hover text-canvas font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"><span>Sign In</span>${RENDER_SVG.arrowRight()}</button>`;
}

export function renderSeoLandingHtml(opts: SeoLandingRenderOptions): string {
  const initialArtifact = DEMO_ARTIFACTS[0];
  const themeLabel = opts.theme === 'night' ? 'Switch to day theme' : 'Switch to night theme';
  const themeIcon = opts.theme === 'night' ? STAGE_SVG.sun() : STAGE_SVG.moon();

  const agentBadges = [
    { label: 'Claude Code', bg: 'var(--ag-claude-bg)', fg: 'var(--ag-claude-fg)', dot: 'var(--ag-claude-dot)' },
    { label: 'OpenAI Codex', bg: 'var(--ag-codex-bg)', fg: 'var(--ag-codex-fg)', dot: 'var(--ag-codex-dot)' },
    { label: 'Google Antigravity', bg: 'var(--ag-agy-bg)', fg: 'var(--ag-agy-fg)', dot: 'var(--ag-agy-dot)' },
  ]
    .map(
      (ag) =>
        `<span style="background-color:${ag.bg};color:${ag.fg}" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border border-line/70"><span class="w-1.5 h-1.5 rounded-full" style="background-color:${ag.dot}" aria-hidden="true"></span>${ag.label}</span>`
    )
    .join('');

  const sidebarButtons = DEMO_ARTIFACTS.map((item) => {
    const isSel = item.id === initialArtifact.id;
    const btnCls = isSel ? 'bg-sage-soft shadow-[inset_2px_0_0_var(--color-sage)]' : 'hover:bg-sunken';
    const iconWrapCls = isSel
      ? 'bg-raised border border-[var(--c-sage-border)] text-sage'
      : 'bg-sunken text-ink-2';
    return `
      <button type="button" data-ma-artifact="${item.id}" aria-pressed="${isSel}" class="w-full text-left px-2.5 py-2.5 rounded-[9px] grid grid-cols-[28px_1fr_auto] gap-2.5 items-center transition-colors ${btnCls}">
        <span data-ma-art-icon class="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center ${iconWrapCls}">${getArtifactIcon(item.type)}</span>
        <div class="min-w-0">
          <div class="text-[12.5px] font-medium text-ink truncate">${escapeHtml(item.title)}</div>
          <div class="text-[11px] text-ink-3 truncate">${escapeHtml(item.runtimeLabel)} · ${escapeHtml(item.agentLabel)}</div>
        </div>
        <span class="font-mono text-[10.5px] px-1.5 py-[1px] rounded bg-brass-soft text-brass-ink border border-brass-line">v${item.version}</span>
      </button>`;
  }).join('');

  const tabButtons = (
    [
      ['preview', 'Preview'],
      ['diff', 'Diff'],
      ['code', 'Code'],
      ['state', 'State'],
    ] as const
  )
    .map(([tabId, label]) => {
      const cls =
        tabId === 'preview'
          ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(30,36,32,0.08)]'
          : 'text-ink-3 hover:text-ink';
      return `<button type="button" data-ma-tab="${tabId}" aria-pressed="${tabId === 'preview'}" class="min-h-[34px] px-3 rounded-[6px] text-[12px] font-medium transition-colors ${cls}">${label}</button>`;
    })
    .join('');

  const comparisonBody = COMPARISON_ROWS.map(
    (row) => `
      <tr class="hover:bg-canvas/40 transition-colors">
        <td class="py-3.5 px-5 font-medium text-ink">${escapeHtml(row.label)}</td>
        <td class="py-3.5 px-4"><span class="inline-flex items-center gap-1.5 font-medium text-sage">${STAGE_SVG.check('w-3.5 h-3.5 shrink-0')}<span>${escapeHtml(row.myArtifact)}</span></span></td>
        <td class="py-3.5 px-4 text-ink-3">${escapeHtml(row.chatLocked)}</td>
        <td class="py-3.5 px-4 text-ink-3">${escapeHtml(row.rawFiles)}</td>
      </tr>`
  ).join('');

  const faqHtml = FAQ_ITEMS.map(
    (item) => `
      <details class="group rounded-[11px] border border-line bg-canvas px-4 py-3.5 open:border-line-strong transition-colors">
        <summary class="cursor-pointer list-none flex items-center justify-between gap-4 font-medium text-[14.5px] text-ink min-h-[32px]">
          <span>${escapeHtml(item.q)}</span>
          ${RENDER_SVG.chevronDown('w-4 h-4 text-ink-3 shrink-0 group-open:rotate-180 transition-transform')}
        </summary>
        <p class="mt-2.5 mb-0 text-[13.5px] leading-relaxed text-ink-2">${escapeHtml(item.a)}</p>
      </details>`
  ).join('');

  const authCtaMeta = `${opts.isCloudMode ? '1' : '0'}:${opts.googleEnabled ? '1' : '0'}:${opts.authenticated ? '1' : '0'}`;
  const heroCmdDisplay = opts.isCloudMode ? 'myartifact login' : 'myartifact setup';
  const heroCopyKind = opts.isCloudMode ? 'hero-cloud' : 'setup';
  const heroCopyAria = opts.isCloudMode
    ? 'Copy myartifact cloud install and login command'
    : 'Copy myartifact setup command';

  return `
    <div id="top" data-ma-landing="1" data-ma-auth="${authCtaMeta}" class="min-h-screen bg-canvas text-ink selection:bg-[#C7D3C0] selection:text-[#1E2420]">
      <!-- Minimal Sticky Top Bar -->
      <header class="sticky top-0 z-40 border-b border-line/80 bg-canvas/88 backdrop-blur-md">
        <div class="max-w-[1120px] mx-auto px-4 sm:px-8 h-[60px] flex items-center justify-between gap-3">
          <a href="#top" class="flex items-center gap-2.5 text-ink no-underline shrink-0">
            <span aria-hidden="true" class="w-[28px] h-[28px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.12)] [&>svg]:w-full [&>svg]:h-full">${MYARTIFACT_LOGO_SVG}</span>
            <span class="font-semibold text-[15px] tracking-tight text-ink whitespace-nowrap">MyArtifact</span>
          </a>

          <nav aria-label="Primary sections" class="hidden md:flex items-center gap-6 text-[13.5px] text-ink-2">
            <a href="#studio" class="hover:text-ink transition-colors no-underline py-1">Studio</a>
            <a href="#quickstart" class="hover:text-ink transition-colors no-underline py-1">Humans &amp; Agents</a>
            <a href="#features" class="hover:text-ink transition-colors no-underline py-1">Features</a>
            <a href="#faq" class="hover:text-ink transition-colors no-underline py-1">FAQ</a>
          </nav>

          <div class="flex items-center gap-2 shrink-0">
            <button type="button" data-ma-action="toggle-theme" aria-label="${themeLabel}" title="${themeLabel}" class="w-[36px] h-[36px] rounded-[7px] border border-line bg-raised hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors">${themeIcon}</button>
            <a href="https://github.com/TannedCung/MyArtifact" target="_blank" rel="noopener noreferrer" class="hidden sm:inline-flex h-[36px] px-3 rounded-[7px] border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink text-[12.5px] font-medium items-center gap-1.5 transition-colors no-underline"><span>GitHub</span>${RENDER_SVG.externalLink()}</a>
            ${renderPrimaryCtaHtml(opts, false)}
          </div>
        </div>
      </header>

      <main id="main-content">
        <!-- Centered Atmospheric Hero -->
        <section class="relative overflow-hidden">
          <div aria-hidden="true" class="pointer-events-none absolute inset-0 opacity-65" style="background-image:radial-gradient(var(--c-line-strong) 1px, transparent 1px), radial-gradient(ellipse 70% 55% at 50% 0%, var(--c-sage-soft), transparent 72%);background-size:24px 24px, 100% 100%"></div>
          <div class="relative max-w-[1120px] mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-10 text-center">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-raised border border-line text-[11.5px] font-mono uppercase tracking-[0.07em] text-sage shadow-[0_1px_2px_rgba(30,36,32,0.04)] mb-6">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--c-live-dot)]" aria-hidden="true"></span>
              <span>Open-Source MCP Studio · MIT</span>
            </div>

            <h1 class="font-serif text-[36px] sm:text-[54px] leading-[1.08] tracking-[-0.025em] font-semibold text-ink m-0 max-w-[820px] mx-auto">
              One visual studio for <br class="hidden sm:inline" />
              <span class="text-sage italic font-medium">every coding agent.</span>
            </h1>

            <p class="mt-5 text-[16px] sm:text-[18.5px] leading-[1.6] text-ink-2 max-w-[600px] mx-auto">
              Render, diff, and share live React, 3D, Mermaid &amp; TensorBoard artifacts across Claude Code, Codex, and Antigravity.
            </p>

            <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
              ${renderPrimaryCtaHtml(opts, true)}
              <div class="h-[44px] inline-flex items-center gap-2.5 pl-3.5 pr-1.5 rounded-[9px] border border-line-strong bg-raised shadow-[0_1px_2px_rgba(30,36,32,0.05)]">
                ${RENDER_SVG.terminal('w-4 h-4 text-sage shrink-0')}
                <code class="font-mono text-[13px] text-ink whitespace-nowrap">${heroCmdDisplay}</code>
                <button type="button" data-ma-copy="${heroCopyKind}" aria-label="${heroCopyAria}" class="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-canvas hover:bg-sunken text-[11.5px] font-mono text-ink-2 inline-flex items-center gap-1 transition-colors">
                  ${STAGE_SVG.copy()}<span>Copy</span>
                </button>
              </div>
            </div>

            <div class="mt-6 flex flex-wrap items-center justify-center gap-2 text-[12px]">
              ${agentBadges}
              ${
                opts.isCloudMode && !opts.authenticated
                  ? `<button type="button" data-ma-action="open-signin" class="min-h-[30px] px-2.5 rounded-full border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink font-mono text-[11.5px] inline-flex items-center gap-1.5 transition-colors"><span>CLI Sign-In</span></button>`
                  : ''
              }
              ${
                opts.authenticated && opts.userEmail
                  ? `<span class="font-mono text-[11.5px] px-2.5 py-1 rounded-full bg-sunken text-ink-2 border border-line">${escapeHtml(opts.userEmail)}</span>`
                  : ''
              }
            </div>
          </div>
        </section>

        <!-- Elevated Studio Window Centerpiece -->
        <section id="studio" aria-labelledby="studio-heading" class="max-w-[1080px] mx-auto px-5 sm:px-8 pb-20">
          <h2 id="studio-heading" class="sr-only">Interactive MyArtifact Studio Preview</h2>
          <div class="rounded-[16px] border border-line-strong bg-raised shadow-[0_24px_64px_rgba(30,36,32,0.13)] overflow-hidden">
            <div class="h-[42px] px-4 border-b border-line bg-canvas flex items-center justify-between gap-3">
              <div class="flex items-center gap-1.5 shrink-0" aria-hidden="true">
                <span class="w-2.5 h-2.5 rounded-full bg-line-strong"></span>
                <span class="w-2.5 h-2.5 rounded-full bg-line-strong"></span>
                <span class="w-2.5 h-2.5 rounded-full bg-line-strong"></span>
              </div>
              <div data-ma-chrome-path class="px-3 py-0.5 rounded-full bg-raised border border-line font-mono text-[11px] text-ink-3 truncate max-w-[380px]">myartifact.app / ${escapeHtml(initialArtifact.projectPath)} / ${escapeHtml(initialArtifact.slug)}</div>
              <span data-ma-chrome-ver class="font-mono text-[10.5px] px-2 py-0.5 rounded bg-brass-soft text-brass-ink border border-brass-line shrink-0 inline-flex items-center gap-1">${STAGE_SVG.history()}v${initialArtifact.version} LATEST</span>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-[248px_1fr]">
              <aside class="bg-canvas/70 border-b lg:border-b-0 lg:border-r border-line p-2.5 flex flex-col gap-1">${sidebarButtons}</aside>
              <div class="flex flex-col min-w-0 bg-raised">
                <div class="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <h3 data-ma-canvas-title class="m-0 text-[15px] font-semibold text-ink truncate">${escapeHtml(initialArtifact.title)}</h3>
                    <span data-ma-canvas-agent style="background-color:${initialArtifact.agentBg};color:${initialArtifact.agentFg}" class="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"><span class="w-1.5 h-1.5 rounded-full" style="background-color:${initialArtifact.agentDot}" aria-hidden="true"></span>${escapeHtml(initialArtifact.agentLabel)}</span>
                  </div>
                  <div class="flex items-center gap-1 rounded-[8px] bg-sunken p-1 border border-line flex-wrap">${tabButtons}</div>
                </div>
                <div data-ma-stage class="p-5 min-h-[330px] bg-canvas/30 flex flex-col justify-center">${renderStageHtml(initialArtifact, 'preview', 'grpo')}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Dual Onboarding: For Humans & For Agents (Cloud-First) -->
        <section id="quickstart" aria-labelledby="quickstart-heading" class="border-t border-line bg-canvas">
          <div class="max-w-[1120px] mx-auto px-5 sm:px-8 py-20">
            <div class="max-w-[660px]">
              <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">Cloud Onboarding · Two Workflows</span>
              <h2 id="quickstart-heading" class="font-serif text-[28px] sm:text-[38px] leading-[1.12] font-semibold text-ink m-0 mt-2">
                Connect humans &amp; coding agents to Cloud
              </h2>
              <p class="mt-2.5 text-[14.5px] leading-relaxed text-ink-2 m-0">
                Open your workspace in the browser, link your terminal once via Google OIDC, and let Claude Code, Codex, and Antigravity publish live Cloud artifacts.
              </p>
            </div>

            <div class="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- Card 1: For Humans -->
              <article class="min-w-0 rounded-[14px] border border-line bg-raised p-6 flex flex-col justify-between gap-6 shadow-[0_6px_24px_rgba(30,36,32,0.04)]">
                <div class="min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.07em] px-2.5 py-1 rounded-full bg-sage-soft text-sage border border-[var(--c-sage-border)]">
                      ${RENDER_SVG.user('w-3.5 h-3.5')}
                      <span>For Humans</span>
                    </span>
                    <span class="font-mono text-[11px] text-ink-3">Web Studio &amp; Cloud CLI</span>
                  </div>

                  <h3 class="text-[19px] font-semibold text-ink m-0 mt-4">Sign in once &amp; link your local terminal</h3>

                  <ol class="mt-5 p-0 m-0 list-none space-y-4 text-[13.5px] text-ink-2">
                    <li class="flex flex-col gap-1">
                      <span class="font-medium text-ink"><span class="font-mono text-sage mr-1.5">01.</span>Sign in to Cloud Studio</span>
                      <span class="text-ink-2 leading-relaxed">Click <strong class="font-medium text-ink">Continue with Google</strong> above to open personal or team workspaces, inspect side-by-side diffs, and manage Batch Share permissions—zero server setup.</span>
                    </li>

                    <li class="flex flex-col gap-1.5">
                      <span class="font-medium text-ink"><span class="font-mono text-sage mr-1.5">02.</span>Install CLI &amp; authenticate to Cloud</span>
                      <span class="text-ink-2 leading-relaxed">Install from GitHub once and authorize via Google OIDC PKCE (switches profile to <code class="font-mono text-[12px]">cloud</code> under the Safe Agent Scope Ceiling; add <code class="font-mono text-[12px]">--device</code> on SSH):</span>
                      <div class="min-w-0 flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] border border-line bg-canvas font-mono text-[12px] text-ink">
                        <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">npm i -g github:TannedCung/MyArtifact &amp;&amp; myartifact login --cloud https://myartifact.app</code>
                        <button type="button" data-ma-copy="human-login" aria-label="Copy cloud login command" class="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-raised hover:bg-sunken text-[11px] text-ink-2 inline-flex items-center gap-1 shrink-0 transition-colors">
                          ${STAGE_SVG.copy('w-3 h-3')}<span>Copy</span>
                        </button>
                      </div>
                    </li>

                    <li class="flex flex-col gap-1.5">
                      <span class="font-medium text-ink"><span class="font-mono text-sage mr-1.5">03.</span>Wire MCP &amp; skills into your project</span>
                      <span class="text-ink-2 leading-relaxed">Auto-configure <code class="font-mono text-[12px]">.mcp.json</code> and <code class="font-mono text-[12px]">SKILL.md</code> for Claude Code, OpenAI Codex, and Google Antigravity:</span>
                      <div class="min-w-0 flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] border border-line bg-canvas font-mono text-[12px] text-ink">
                        <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">myartifact setup</code>
                        <button type="button" data-ma-copy="human-setup" aria-label="Copy myartifact setup command" class="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-raised hover:bg-sunken text-[11px] text-ink-2 inline-flex items-center gap-1 shrink-0 transition-colors">
                          ${STAGE_SVG.copy('w-3 h-3')}<span>Copy</span>
                        </button>
                      </div>
                    </li>
                  </ol>
                </div>

                <div class="pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
                  <a href="/auth/device" class="min-h-[32px] inline-flex items-center gap-1.5 font-mono text-[12px] text-sage hover:underline no-underline">
                    <span>SSH / Device Code Login</span>${RENDER_SVG.arrowRight('w-3.5 h-3.5')}
                  </a>
                  <span class="font-mono text-[11px] text-ink-3">Safe Agent Scope Ceiling</span>
                </div>
              </article>

              <!-- Card 2: For Agents -->
              <article class="min-w-0 rounded-[14px] border border-line bg-raised p-6 flex flex-col justify-between gap-6 shadow-[0_6px_24px_rgba(30,36,32,0.04)]">
                <div class="min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.07em] px-2.5 py-1 rounded-full bg-brass-soft text-brass-ink border border-brass-line">
                      ${RENDER_SVG.bot('w-3.5 h-3.5')}
                      <span>For Agents</span>
                    </span>
                    <span class="font-mono text-[11px] text-ink-3">Cloud MCP · SKILL.md · llms.txt</span>
                  </div>

                  <h3 class="text-[19px] font-semibold text-ink m-0 mt-4">Publish live artifacts straight to Cloud</h3>

                  <div class="mt-4 rounded-[10px] border border-line-strong bg-canvas p-3.5">
                    <div class="flex items-center justify-between gap-2 mb-2">
                      <span class="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">Bootstrap Instruction (Paste to Agent)</span>
                      <button type="button" data-ma-copy="agent-prompt" aria-label="Copy prompt for coding agent" class="min-h-[32px] px-2.5 rounded-[6px] border border-line bg-raised hover:bg-sunken text-[11px] font-mono text-ink-2 inline-flex items-center gap-1 shrink-0 transition-colors">
                        ${STAGE_SVG.copy('w-3 h-3')}<span>Copy Prompt</span>
                      </button>
                    </div>
                    <p class="m-0 font-mono text-[12px] leading-[1.6] text-ink break-words">${escapeHtml(AGENT_BOOTSTRAP_PROMPT)}</p>
                  </div>

                  <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12.5px]">
                    <div class="p-3 rounded-[9px] border border-line bg-canvas">
                      <div class="font-mono text-[11px] text-sage font-medium">1 · Verify CLI &amp; Session</div>
                      <div class="text-ink-2 mt-1">Run <code class="font-mono text-[11.5px]">myartifact whoami</code> (or <code class="font-mono text-[11.5px]">npm i -g github:TannedCung/MyArtifact</code> first) to confirm <code class="font-mono text-[11.5px]">profile: cloud</code>.</div>
                    </div>
                    <div class="p-3 rounded-[9px] border border-line bg-canvas">
                      <div class="font-mono text-[11px] text-sage font-medium">2 · Orient via Cloud Wiki</div>
                      <div class="text-ink-2 mt-1">Call <code class="font-mono text-[11.5px]">artifact_wiki_index()</code> first to inspect cloud projects, categories &amp; backlinks.</div>
                    </div>
                    <div class="p-3 rounded-[9px] border border-line bg-canvas">
                      <div class="font-mono text-[11px] text-sage font-medium">3 · Publish Visual Runtimes</div>
                      <div class="text-ink-2 mt-1">Prefer <code class="font-mono text-[11.5px]">react</code>, <code class="font-mono text-[11.5px]">html</code>, <code class="font-mono text-[11.5px]">threejs</code>, <code class="font-mono text-[11.5px]">mermaid</code>, or <code class="font-mono text-[11.5px]">tb_log_scalars</code> &amp; share <code class="font-mono text-[11.5px]">/artifacts/&lt;slug&gt;</code>.</div>
                    </div>
                    <div class="p-3 rounded-[9px] border border-line bg-canvas">
                      <div class="font-mono text-[11px] text-sage font-medium">4 · Safe Scope Ceiling</div>
                      <div class="text-ink-2 mt-1">Cloud reads/writes succeed; deletes &amp; ACL share edits stay blocked without <code class="font-mono text-[11.5px]">--elevate</code>.</div>
                    </div>
                  </div>
                </div>

                <div class="pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
                  <a href="/llms.txt" class="min-h-[32px] inline-flex items-center gap-1.5 font-mono text-[12px] text-sage hover:underline no-underline">
                    <span>Open Cloud Agent Spec (/llms.txt)</span>${RENDER_SVG.arrowRight('w-3.5 h-3.5')}
                  </a>
                  <span class="font-mono text-[11px] text-ink-3">8 Cloud MCP Tools · Moss Theme</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <!-- 4-Card Visual Bento Grid -->
        <section id="features" aria-labelledby="features-heading" class="border-t border-line bg-raised">
          <div class="max-w-[1120px] mx-auto px-5 sm:px-8 py-20">
            <div class="max-w-[540px]">
              <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">How It Works</span>
              <h2 id="features-heading" class="font-serif text-[28px] sm:text-[38px] leading-[1.12] font-semibold text-ink m-0 mt-2">Built for multi-agent workflows</h2>
            </div>

            <div class="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-5">
              <article class="lg:col-span-7 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div class="rounded-[10px] border border-line bg-raised p-4 flex flex-wrap items-center justify-between gap-2.5">
                  <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span class="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style="background-color:var(--ag-claude-bg);color:var(--ag-claude-fg)">v1 · Claude</span>
                    ${RENDER_SVG.arrowRight('w-3.5 h-3.5 text-ink-3 shrink-0')}
                    <span class="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style="background-color:var(--ag-codex-bg);color:var(--ag-codex-fg)">v2 · Codex +18 -4</span>
                    ${RENDER_SVG.arrowRight('w-3.5 h-3.5 text-ink-3 shrink-0')}
                    <span class="px-2.5 py-1.5 rounded-[7px] font-mono text-[11.5px] font-medium border border-line whitespace-nowrap" style="background-color:var(--ag-agy-bg);color:var(--ag-agy-fg)">v3 · Antigravity</span>
                  </div>
                  <span class="font-mono text-[11px] px-2 py-1 rounded bg-brass-soft text-brass-ink border border-brass-line whitespace-nowrap">index.md Wiki</span>
                </div>
                <div>
                  <h3 class="text-[17px] font-semibold text-ink m-0">Cross-Agent Version Timeline</h3>
                  <p class="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">Hand off visual work between assistants with immutable checkpoints, unified diffs, and 1-click rollback.</p>
                </div>
              </article>

              <article class="lg:col-span-5 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div class="rounded-[10px] border border-line bg-raised p-4 flex flex-col gap-2">
                  <div class="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">${STAGE_SVG.check('w-3 h-3')}artifacts:read</span>
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">${STAGE_SVG.check('w-3 h-3')}artifacts:write</span>
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">${STAGE_SVG.check('w-3 h-3')}storage:write</span>
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-sage-soft text-sage border border-[var(--c-sage-border)]">${STAGE_SVG.check('w-3 h-3')}tb:write</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-brass-soft text-brass-ink border border-brass-line">${RENDER_SVG.lock()}artifacts:delete</span>
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-brass-soft text-brass-ink border border-brass-line">${RENDER_SVG.lock()}iam:share</span>
                  </div>
                </div>
                <div>
                  <h3 class="text-[17px] font-semibold text-ink m-0">Safe Agent Scope Ceiling</h3>
                  <p class="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">Log in once via <code class="font-mono text-[12.5px]">myartifact login</code>; agents share your identity while destructive actions stay blocked.</p>
                </div>
              </article>

              <article class="lg:col-span-5 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div class="rounded-[10px] border border-line bg-raised p-4 flex items-center justify-between gap-3">
                  <div class="space-y-1.5">
                    <div class="inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded bg-sunken text-ink border border-line">${RENDER_SVG.folderTree('w-3.5 h-3.5 text-sage')}Workspace → Private Project</div>
                    <div class="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">${RENDER_SVG.shieldCheck('w-3.5 h-3.5 text-sage')}<span>@acme.com + Share Links</span></div>
                  </div>
                  <span class="font-mono text-[11px] px-2.5 py-1 rounded-full bg-sage text-canvas shrink-0">Google OIDC</span>
                </div>
                <div>
                  <h3 class="text-[17px] font-semibold text-ink m-0">Cascading RBAC &amp; Batch Sharing</h3>
                  <p class="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">Grant roles across selected artifacts or folders for emails, groups, Google domains, or expiring links.</p>
                </div>
              </article>

              <article class="lg:col-span-7 rounded-[14px] border border-line bg-canvas p-6 flex flex-col justify-between gap-6">
                <div class="rounded-[10px] border border-line bg-raised p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="p-3 rounded-[8px] border border-line bg-canvas flex items-center gap-2.5">
                    ${RENDER_SVG.database('w-4 h-4 text-sage shrink-0')}
                    <div>
                      <div class="text-[12.5px] font-semibold text-ink">Local Offline Studio</div>
                      <div class="font-mono text-[11px] text-ink-3">SQLite FTS5 · WebSocket</div>
                    </div>
                  </div>
                  <div class="p-3 rounded-[8px] border border-[var(--c-sage-border)] bg-sage-soft/50 flex items-center gap-2.5">
                    ${RENDER_SVG.sparkles('w-4 h-4 text-sage shrink-0')}
                    <div>
                      <div class="text-[12.5px] font-semibold text-ink">$0/mo Serverless Cloud</div>
                      <div class="font-mono text-[11px] text-ink-3">Vercel · Neon · R2 · ETag</div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 class="text-[17px] font-semibold text-ink m-0">Local SQLite or $0/mo Serverless Cloud</h3>
                  <p class="text-[14px] text-ink-2 m-0 mt-1.5 leading-relaxed">Run 100% locally on disk, or deploy statelessly on Vercel Hobby, Neon Postgres, and Cloudflare R2.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <!-- Clean Checkmark Comparison Table -->
        <section aria-labelledby="compare-heading" class="max-w-[920px] mx-auto px-5 sm:px-8 py-20">
          <div class="text-center mb-8">
            <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">Comparison</span>
            <h2 id="compare-heading" class="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-2">At a glance</h2>
          </div>
          <div class="rounded-[14px] border border-line bg-raised overflow-x-auto shadow-[0_6px_24px_rgba(30,36,32,0.05)]">
            <table class="w-full text-left border-collapse text-[13.5px] min-w-[560px]">
              <thead>
                <tr class="border-b border-line bg-canvas/70 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <th class="py-3.5 px-5 font-medium">Capability</th>
                  <th class="py-3.5 px-4 font-semibold text-sage">MyArtifact</th>
                  <th class="py-3.5 px-4 font-medium">Chat Artifacts</th>
                  <th class="py-3.5 px-4 font-medium">Local Files</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">${comparisonBody}</tbody>
            </table>
          </div>
        </section>

        <!-- Calm 5-Item FAQ -->
        <section id="faq" aria-labelledby="faq-heading" class="border-t border-line bg-raised">
          <div class="max-w-[760px] mx-auto px-5 sm:px-8 py-20">
            <div class="text-center mb-8">
              <span class="font-mono text-[11px] uppercase tracking-[0.08em] text-sage">FAQ</span>
              <h2 id="faq-heading" class="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0 mt-2">Common questions</h2>
            </div>
            <div class="space-y-2.5">${faqHtml}</div>
          </div>
        </section>

        <!-- Quiet Closing CTA -->
        <section class="max-w-[920px] mx-auto px-5 sm:px-8 py-16">
          <div class="rounded-[16px] border border-[var(--c-sage-border)] bg-sage-soft/50 px-6 py-10 text-center flex flex-col items-center gap-4">
            <h2 class="font-serif text-[26px] sm:text-[34px] font-semibold text-ink m-0">Start in 10 seconds.</h2>
            <p class="text-[14.5px] text-ink-2 m-0 max-w-[540px]">Sign in with Google to open your Cloud workspace, then run <code class="font-mono text-[13px] px-1.5 py-0.5 rounded bg-raised border border-line">npm i -g github:TannedCung/MyArtifact</code>, <code class="font-mono text-[13px] px-1.5 py-0.5 rounded bg-raised border border-line">myartifact login</code>, and <code class="font-mono text-[13px] px-1.5 py-0.5 rounded bg-raised border border-line">myartifact setup</code> to connect your coding agents.</p>
            <div class="mt-2 flex flex-wrap items-center justify-center gap-3">${renderPrimaryCtaHtml(opts, true)}</div>
          </div>
        </section>
      </main>

      <!-- Clean Single-Row Footer -->
      <footer class="border-t border-line bg-canvas">
        <div class="max-w-[1120px] mx-auto px-5 sm:px-8 py-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[12.5px] text-ink-3">
          <div class="flex items-center gap-2">
            <span aria-hidden="true" class="w-[20px] h-[20px] rounded-[5px] overflow-hidden flex items-center justify-center [&>svg]:w-full [&>svg]:h-full">${MYARTIFACT_LOGO_SVG}</span>
            <span><strong class="text-ink">MyArtifact</strong> · MIT License</span>
          </div>
          <nav aria-label="Footer navigation" class="flex flex-wrap items-center gap-5">
            <a href="/signin" class="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">Sign In</a>
            <a href="/auth/device" class="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">CLI Device Flow</a>
            <a href="/llms.txt" class="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">llms.txt</a>
            <a href="/sitemap.xml" class="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">Sitemap</a>
            <a href="https://github.com/TannedCung/MyArtifact" target="_blank" rel="noopener noreferrer" class="py-1.5 px-1 hover:text-ink transition-colors no-underline text-ink-2 inline-flex items-center">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>`;
}
