import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeoLandingPage } from './components/SeoLandingPage.js';
import { MYARTIFACT_LOGO_SVG } from '../core/brand-logo.js';
import { syncDocumentSeo } from './seo-head.js';
import './styles.css';

declare const __DEFAULT_CLOUD_MODE__: boolean;

const LazyStudioApp = React.lazy(() => import('./App.js'));

const DEFAULT_SEO_TITLE =
  'MyArtifact — Visual Artifact Studio & MCP Server for Claude Code, Codex & Antigravity';
const DEFAULT_SEO_DESC =
  'Open-source local-first and cloud visual artifact studio & MCP server for Claude Code, OpenAI Codex, and Google Antigravity. Render sandboxed React, Three.js, Mermaid, HTML, SVG & TensorBoard runs with immutable version history, diffs, and cascading RBAC.';

type StudioTheme = 'day' | 'night';

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

function classifyRoute(pathname: string, search: string): 'landing' | 'studio' | 'not_found' {
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

const NotFoundPage: React.FC<{ onGoHome: () => void }> = ({ onGoHome }) => (
  <main className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">
    <div className="max-w-[460px] w-full rounded-[14px] border border-line bg-raised p-7 text-center flex flex-col items-center gap-4 shadow-[0_12px_36px_rgba(30,36,32,0.08)]">
      <div
        className="w-10 h-10 rounded-[9px] overflow-hidden border border-line [&>svg]:w-full [&>svg]:h-full"
        dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
      />
      <div className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
        HTTP 404 · Route Not Found
      </div>
      <h1 className="font-serif text-[26px] font-semibold text-ink m-0">
        404 — Page not found
      </h1>
      <p className="text-[14px] text-ink-2 m-0 leading-relaxed">
        This path does not match a studio view, artifact slug, or share link on MyArtifact.
      </p>
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onGoHome();
        }}
        className="h-[40px] px-5 rounded-[8px] bg-sage hover:bg-sage-hover text-canvas text-[13.5px] font-medium inline-flex items-center justify-center no-underline transition-colors"
      >
        ← Back to MyArtifact Home
      </a>
    </div>
  </main>
);

const RootShell: React.FC = () => {
  const [locState, setLocState] = useState(() =>
    typeof window !== 'undefined'
      ? { pathname: window.location.pathname, search: window.location.search }
      : { pathname: '/', search: '' }
  );
  const [theme, setTheme] = useState<StudioTheme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ma-studio-theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    const syncLoc = () => {
      setLocState({ pathname: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', syncLoc);
    return () => window.removeEventListener('popstate', syncLoc);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'night' ? 'day' : 'night'));
  }, []);

  const navigateTo = useCallback((url: string) => {
    window.history.pushState({}, '', url);
    setLocState({ pathname: window.location.pathname, search: window.location.search });
  }, []);

  const routeKind = classifyRoute(locState.pathname, locState.search);

  useEffect(() => {
    if (routeKind === 'landing') {
      syncDocumentSeo({
        title: DEFAULT_SEO_TITLE,
        description: DEFAULT_SEO_DESC,
        canonicalPath: '/',
        noindex: false,
      });
    } else if (routeKind === 'not_found') {
      syncDocumentSeo({
        title: '404 — Page Not Found | MyArtifact',
        canonicalPath: '/',
        noindex: true,
      });
    }
  }, [routeKind]);

  if (routeKind === 'not_found') {
    return <NotFoundPage onGoHome={() => navigateTo('/')} />;
  }

  if (routeKind === 'landing') {
    const hasCsrfCookie =
      typeof document !== 'undefined' && document.cookie.includes('ma_csrf=');
    return (
      <SeoLandingPage
        theme={theme}
        onToggleTheme={toggleTheme}
        isCloudMode={__DEFAULT_CLOUD_MODE__}
        googleEnabled={true}
        authenticated={Boolean(__DEFAULT_CLOUD_MODE__ && hasCsrfCookie)}
        userEmail={null}
        onOpenStudio={() => navigateTo('/?view=studio')}
        onOpenSignIn={() => navigateTo('/signin')}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen bg-canvas text-ink-2 flex items-center justify-center text-[13px]">
          Initializing MyArtifact Studio…
        </div>
      }
    >
      <LazyStudioApp />
    </Suspense>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <RootShell />
    </React.StrictMode>
  );
}
