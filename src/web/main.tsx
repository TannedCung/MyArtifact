import { MYARTIFACT_LOGO_SVG } from '../core/brand-logo.js';
import { syncDocumentSeo } from './seo-head.js';
import {
  bindSeoLandingEvents,
  syncSeoLandingTheme,
} from './seo-landing-dom.js';
import './styles.css';

declare const __DEFAULT_CLOUD_MODE__: boolean;

const DEFAULT_SEO_TITLE =
  'MyArtifact — Visual Artifact Studio & MCP Server for Claude Code, Codex & Antigravity';
const DEFAULT_SEO_DESC =
  'Open-source local-first and cloud visual artifact studio & MCP server for Claude Code, OpenAI Codex, and Google Antigravity. Render sandboxed React, Three.js, Mermaid, HTML, SVG & TensorBoard runs with immutable version history, diffs, and cascading RBAC.';

type StudioTheme = 'day' | 'night';
type RouteKind = 'landing' | 'studio' | 'not_found';

function readInitialTheme(): StudioTheme {
  try {
    const saved = localStorage.getItem('ma-studio-theme');
    if (saved === 'day' || saved === 'night') return saved;
  } catch {
    // Ignore storage access errors
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'night';
  }
  return 'day';
}

function applyTheme(theme: StudioTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('ma-studio-theme', theme);
  } catch {
    // Ignore storage access errors
  }
}

function classifyRoute(pathname: string, search: string): RouteKind {
  const params = new URLSearchParams(search);
  const view = params.get('view');

  if (
    pathname === '/welcome' ||
    pathname === '/about' ||
    pathname === '/features' ||
    view === 'welcome'
  ) {
    return 'landing';
  }

  const hasCsrfCookie =
    typeof document !== 'undefined' && document.cookie.includes('ma_csrf=');

  if (pathname === '/') {
    if (
      view === 'studio' ||
      params.has('artifact') ||
      params.has('share') ||
      params.get('signin') === '1' ||
      !__DEFAULT_CLOUD_MODE__ ||
      hasCsrfCookie
    ) {
      return 'studio';
    }
    return 'landing';
  }

  if (
    pathname === '/signin' ||
    pathname === '/auth/cli/authorize' ||
    pathname === '/auth/device' ||
    /^\/s\/[^/?#]+$/.test(pathname) ||
    /^\/(?:artifacts|a)\/[^/?#]+$/.test(pathname)
  ) {
    return 'studio';
  }

  return 'not_found';
}

function renderNotFoundHtml(): string {
  return `
    <main class="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">
      <div class="max-w-[460px] w-full rounded-[14px] border border-line bg-raised p-7 text-center flex flex-col items-center gap-4 shadow-[0_12px_36px_rgba(30,36,32,0.08)]">
        <div class="w-10 h-10 rounded-[9px] overflow-hidden border border-line [&>svg]:w-full [&>svg]:h-full">${MYARTIFACT_LOGO_SVG}</div>
        <div class="font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-3">HTTP 404 · Route Not Found</div>
        <h1 class="font-serif text-[26px] font-semibold text-ink m-0">404 — Page not found</h1>
        <p class="text-[14px] text-ink-2 m-0 leading-relaxed">
          This path does not match a studio view, artifact slug, or share link on MyArtifact.
        </p>
        <a href="/" data-ma-go-home class="h-[40px] px-5 rounded-[8px] bg-sage hover:bg-sage-hover text-canvas text-[13.5px] font-medium inline-flex items-center justify-center no-underline transition-colors">
          ← Back to MyArtifact Home
        </a>
      </div>
    </main>`;
}

function bootstrapRootShell(): void {
  const container = document.getElementById('root');
  if (!container) return;

  let currentTheme: StudioTheme = readInitialTheme();
  applyTheme(currentTheme);

  let cleanupView: (() => void) | null = null;
  let routeSeq = 0;
  let studioModulePromise: Promise<typeof import('./studio-entry.js')> | null = null;

  const loadStudioModule = () => {
    if (!studioModulePromise) {
      studioModulePromise = import('./studio-entry.js');
    }
    return studioModulePromise;
  };

  const navigateTo = (url: string) => {
    window.history.pushState({}, '', url);
    renderRoute();
  };

  const renderRoute = () => {
    const seq = ++routeSeq;
    const routeKind = classifyRoute(window.location.pathname, window.location.search);

    if (cleanupView) {
      cleanupView();
      cleanupView = null;
    }

    if (routeKind === 'not_found') {
      syncDocumentSeo({
        title: '404 — Page Not Found | MyArtifact',
        canonicalPath: '/',
        noindex: true,
      });
      if (studioModulePromise) {
        delete container.dataset.maStudioReady;
        void studioModulePromise.then((m) => m.unmountStudioApp());
      }
      container.innerHTML = renderNotFoundHtml();
      const homeLink = container.querySelector<HTMLAnchorElement>('[data-ma-go-home]');
      const onGoHome = (e: MouseEvent) => {
        e.preventDefault();
        navigateTo('/');
      };
      homeLink?.addEventListener('click', onGoHome);
      cleanupView = () => homeLink?.removeEventListener('click', onGoHome);
      return;
    }

    if (routeKind === 'landing') {
      syncDocumentSeo({
        title: DEFAULT_SEO_TITLE,
        description: DEFAULT_SEO_DESC,
        canonicalPath: '/',
        noindex: false,
      });
      if (studioModulePromise) {
        delete container.dataset.maStudioReady;
        void studioModulePromise.then((m) => m.unmountStudioApp());
      }

      const isCloudMode = Boolean(__DEFAULT_CLOUD_MODE__);
      const googleEnabled = true;
      const hasCsrfCookie =
        typeof document !== 'undefined' && document.cookie.includes('ma_csrf=');
      const authenticated = Boolean(isCloudMode && hasCsrfCookie);
      const expectedAuthMeta = `${isCloudMode ? '1' : '0'}:${googleEnabled ? '1' : '0'}:${authenticated ? '1' : '0'}`;

      const attachLandingEvents = () => {
        cleanupView = bindSeoLandingEvents(container, {
          onToggleTheme: () => {
            currentTheme = currentTheme === 'night' ? 'day' : 'night';
            applyTheme(currentTheme);
            syncSeoLandingTheme(container, currentTheme);
          },
          onOpenStudio: () => navigateTo('/?view=studio'),
          onOpenSignIn: () => navigateTo('/signin'),
        });
      };

      const preRendered = container.querySelector<HTMLElement>('[data-ma-landing="1"]');
      if (preRendered && preRendered.dataset.maAuth === expectedAuthMeta) {
        syncSeoLandingTheme(container, currentTheme);
        attachLandingEvents();
        return;
      }

      void import('./seo-landing-render.js').then(({ renderSeoLandingHtml }) => {
        if (seq !== routeSeq) return;
        container.innerHTML = renderSeoLandingHtml({
          theme: currentTheme,
          isCloudMode,
          googleEnabled,
          authenticated,
          userEmail: null,
        });
        attachLandingEvents();
      });
      return;
    }

    // Studio route: lazy-load React & Studio bundle
    if (!container.dataset.maStudioReady) {
      container.innerHTML =
        '<div class="h-screen w-screen bg-canvas text-ink-2 flex items-center justify-center text-[13px]">Initializing MyArtifact Studio…</div>';
    }

    void loadStudioModule().then((mod) => {
      if (seq !== routeSeq) return;
      container.dataset.maStudioReady = '1';
      mod.mountStudioApp(container);
    });
  };

  window.addEventListener('popstate', renderRoute);
  renderRoute();
}

bootstrapRootShell();
