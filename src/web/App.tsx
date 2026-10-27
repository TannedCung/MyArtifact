import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  Search,
  Plus,
  Moon,
  Sun,
  History,
  ChevronDown,
  Download,
  Ellipsis,
  Copy,
  Terminal,
  Trash2,
  Monitor,
  Tablet,
  Smartphone,
  RotateCcw,
  ShieldCheck,
  FileCode,
  Atom,
  CodeXml,
  Workflow,
  FileText,
  PenTool,
  FilePlus,
  LayoutDashboard,
  Calculator,
  X,
  CircleAlert,
  Check,
  GitCompare,
  Palette,
  Activity,
  Eye,
  RotateCw,
  ExternalLink,
  Link2,
  Maximize2,
  Minimize2,
  Database,
  ArrowLeft,
} from 'lucide-react';
import { SandboxRenderer } from './components/SandboxRenderer.js';
import { DiffViewer } from './components/DiffViewer.js';
import {
  MYARTIFACT_LOGO_SVG,
  resolveArtifactIconSvg,
  svgToDataUri,
} from '../core/icons.js';
import {
  KIT_TEMPLATES,
  KIT_THEMES,
  applyTemplateTheme,
  type KitTemplate,
} from './templates.js';
import type {
  ArtifactDetail,
  ArtifactMetadata,
  ArtifactType,
  StorageEntry,
} from '../core/types.js';

type ActiveTab = 'preview' | 'code' | 'diff' | 'storage';
type ViewportSize = 'desktop' | 'tablet' | 'mobile';
type StudioTheme = 'day' | 'night';
type PageMode = 'artifact' | 'studio';

function parseRouteFromLocation(): {
  mode: PageMode;
  artifactSlug: string | null;
  version: number | null;
  tab: ActiveTab | null;
} {
  if (typeof window === 'undefined') {
    return { mode: 'studio', artifactSlug: null, version: null, tab: null };
  }
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const verParam = params.get('v') || params.get('version');
  const version =
    verParam && !Number.isNaN(Number(verParam)) ? Number(verParam) : null;
  const tabParam = params.get('tab') as ActiveTab | null;
  const tab =
    tabParam && ['preview', 'code', 'diff', 'storage'].includes(tabParam)
      ? tabParam
      : null;

  const pathMatch = pathname.match(/^\/(?:artifacts|a)\/([^/?#]+)/);
  if (pathMatch) {
    return {
      mode: 'artifact',
      artifactSlug: decodeURIComponent(pathMatch[1]),
      version,
      tab,
    };
  }

  const queryArtifact = params.get('artifact');
  const viewParam = params.get('view');

  if (queryArtifact && viewParam !== 'studio') {
    return {
      mode: 'artifact',
      artifactSlug: queryArtifact,
      version,
      tab,
    };
  }

  return {
    mode: 'studio',
    artifactSlug: queryArtifact,
    version,
    tab,
  };
}

const AGENT_META: Record<
  string,
  { label: string; dot: string; bg: string; fg: string }
> = {
  'claude-code': {
    label: 'Claude Code',
    dot: 'var(--ag-claude-dot)',
    bg: 'var(--ag-claude-bg)',
    fg: 'var(--ag-claude-fg)',
  },
  codex: {
    label: 'Codex',
    dot: 'var(--ag-codex-dot)',
    bg: 'var(--ag-codex-bg)',
    fg: 'var(--ag-codex-fg)',
  },
  antigravity: {
    label: 'Antigravity',
    dot: 'var(--ag-agy-dot)',
    bg: 'var(--ag-agy-bg)',
    fg: 'var(--ag-agy-fg)',
  },
  watcher: {
    label: 'Watched file',
    dot: 'var(--ag-watcher-dot)',
    bg: 'var(--ag-watcher-bg)',
    fg: 'var(--ag-watcher-fg)',
  },
  user: {
    label: 'You',
    dot: 'var(--ag-user-dot)',
    bg: 'var(--ag-user-bg)',
    fg: 'var(--ag-user-fg)',
  },
};

function getAgentInfo(agent: string) {
  return (
    AGENT_META[agent] || {
      label: agent,
      dot: 'var(--ag-user-dot)',
      bg: 'var(--ag-user-bg)',
      fg: 'var(--ag-user-fg)',
    }
  );
}

const TYPE_META: Record<
  ArtifactType,
  { label: string; ext: string; Icon: React.FC<{ className?: string }> }
> = {
  react: { label: 'React', ext: 'tsx', Icon: Atom },
  html: { label: 'HTML', ext: 'html', Icon: CodeXml },
  mermaid: { label: 'Mermaid', ext: 'mmd', Icon: Workflow },
  markdown: { label: 'Markdown', ext: 'md', Icon: FileText },
  svg: { label: 'SVG', ext: 'svg', Icon: PenTool },
  tensorboard: { label: 'TensorBoard', ext: 'tb.json', Icon: Activity },
  code: { label: 'Code', ext: 'txt', Icon: FileCode },
};

const TEMPLATE_ICONS: Record<
  KitTemplate['id'],
  React.FC<{ className?: string }>
> = {
  blank: FilePlus,
  dashboard: LayoutDashboard,
  report: FileText,
  diagram: Workflow,
  tool: Calculator,
  training: Activity,
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function detectArtifactType(content: string): ArtifactType | null {
  const s = content.trim();
  if (!s) return null;
  if (s.startsWith('{') && s.includes('"scalars"') && s.includes('"runSlug"')) {
    return 'tensorboard';
  }
  if (/^<svg/i.test(s)) return 'svg';
  if (/^</.test(s) && !/^<style/i.test(s) && !/^<p\s/i.test(s)) return 'html';
  if (
    /^(flowchart|graph|sequenceDiagram|erDiagram|stateDiagram|classDiagram|%%\{init)/m.test(
      s
    )
  ) {
    return 'mermaid';
  }
  if (/^(import|export)\s/m.test(s) || /React/.test(s)) return 'react';
  if (/^#/m.test(s) || /^<style/i.test(s)) return 'markdown';
  return 'code';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return 'just now';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 45_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function App() {
  const initialRoute = useMemo(() => parseRouteFromLocation(), []);
  const [pageMode, setPageMode] = useState<PageMode>(initialRoute.mode);
  const [artifacts, setArtifacts] = useState<ArtifactMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRoute.artifactSlug
  );
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(
    initialRoute.version
  );
  const [versionContent, setVersionContent] = useState<string>('');
  const [storageEntries, setStorageEntries] = useState<StorageEntry[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    initialRoute.tab || 'preview'
  );
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [notFoundSlug, setNotFoundSlug] = useState<string | null>(null);

  // Redesign UI & interaction state
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [verOpen, setVerOpen] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [paletteIndex, setPaletteIndex] = useState<number>(0);
  const [confirmDeleteText, setConfirmDeleteText] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState<boolean>(true);
  const [theme, setTheme] = useState<StudioTheme>(() => {
    try {
      const saved = localStorage.getItem('ma-studio-theme');
      if (saved === 'night' || saved === 'day') return saved;
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
  });

  // Code editor & WebSocket state
  const [draftCode, setDraftCode] = useState<string>('');
  const [commitSummary, setCommitSummary] = useState<string>('');
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Storage editor state
  const [newStorageKey, setNewStorageKey] = useState<string>('');
  const [newStorageValue, setNewStorageValue] = useState<string>('');

  // New Artifact modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [template, setTemplate] = useState<KitTemplate['id']>('blank');
  const [themeId, setThemeId] = useState<string>('moss');
  const [newContent, setNewContent] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);

  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 2400);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ma-studio-theme', theme);
    } catch {
      // Ignore storage access errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'night' ? 'day' : 'night'));
  }, []);

  const closeAllOverlays = useCallback(() => {
    setVerOpen(false);
    setMenuOpen(false);
    setPaletteOpen(false);
    setShowCreateModal(false);
    setDeleteOpen(false);
    setConfirmDeleteText('');
  }, []);

  const openCreateModal = useCallback(
    (initialTemplate: KitTemplate['id'] = 'blank') => {
      setVerOpen(false);
      setMenuOpen(false);
      setPaletteOpen(false);
      setDeleteOpen(false);
      setSubmitted(false);
      if (initialTemplate === 'blank') {
        setNewTitle('');
        setTemplate('blank');
        setThemeId('moss');
        setNewContent('');
      } else {
        const tpl =
          KIT_TEMPLATES.find((t) => t.id === initialTemplate) || KIT_TEMPLATES[1];
        setTemplate(tpl.id);
        setThemeId('moss');
        setNewTitle(tpl.label);
        setNewContent(applyTemplateTheme(tpl.type, tpl.content, 'moss'));
      }
      setShowCreateModal(true);
    },
    []
  );

  const navigateToArtifactPage = useCallback((slugOrId: string) => {
    const cleanUrl = `/artifacts/${encodeURIComponent(slugOrId)}`;
    window.history.pushState({}, '', cleanUrl);
    setPageMode('artifact');
    setSelectedId(slugOrId);
    setVerOpen(false);
    setMenuOpen(false);
    setNotFoundSlug(null);
  }, []);

  const navigateToStudio = useCallback((slugOrId?: string | null) => {
    const nextUrl = slugOrId
      ? `/?view=studio&artifact=${encodeURIComponent(slugOrId)}`
      : '/?view=studio';
    window.history.pushState({}, '', nextUrl);
    setPageMode('studio');
    setZenMode(false);
    if (slugOrId) setSelectedId(slugOrId);
    setVerOpen(false);
    setMenuOpen(false);
    setNotFoundSlug(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = parseRouteFromLocation();
      setPageMode(route.mode);
      if (route.artifactSlug) {
        setSelectedId(route.artifactSlug);
      }
      if (route.version) {
        setSelectedVersion(route.version);
      }
      if (route.tab) {
        setActiveTab(route.tab);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Fetch artifacts list
  const fetchList = useCallback(async () => {
    const res = await fetch('/api/artifacts');
    const data = await res.json();
    const list: ArtifactMetadata[] = (data.artifacts || []).sort(
      (a: ArtifactMetadata, b: ArtifactMetadata) =>
        b.updatedAt.localeCompare(a.updatedAt)
    );
    setArtifacts(list);

    if (!selectedId && list.length > 0 && pageMode === 'studio') {
      const route = parseRouteFromLocation();
      const target =
        list.find(
          (a) => a.slug === route.artifactSlug || a.id === route.artifactSlug
        ) || list[0];
      setSelectedId(target.id);
    }
  }, [selectedId, pageMode]);

  const fetchDetail = useCallback(async (id: string, preserveVersion = false) => {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setNotFoundSlug(id);
      return;
    }
    setNotFoundSlug(null);
    const data = await res.json();
    const art: ArtifactDetail = data.artifact;
    setDetail(art);
    setStorageEntries(data.storage || []);
    if (!preserveVersion) {
      const route = parseRouteFromLocation();
      const targetVer =
        route.version && route.version <= art.currentVersion
          ? route.version
          : art.currentVersion;
      setSelectedVersion(targetVer);
      setVersionContent(art.content);
      setDraftCode(art.content);
    }
  }, []);

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link#app-favicon');
    if (!link) {
      link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    }
    if (!link) {
      link = document.createElement('link');
      link.id = 'app-favicon';
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }

    if (pageMode === 'artifact' && detail) {
      document.title = detail.title;
      const artSvg = resolveArtifactIconSvg(detail);
      link.type = 'image/svg+xml';
      link.href = svgToDataUri(artSvg);
    } else {
      document.title = detail
        ? `${detail.title} — MyArtifact Studio`
        : 'MyArtifact — Local Cross-Assistant Artifact Studio';
      link.type = 'image/svg+xml';
      link.href = svgToDataUri(MYARTIFACT_LOGO_SVG);
    }
  }, [detail, pageMode]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  // Load historical version content when stepping through timeline
  useEffect(() => {
    if (!detail || !selectedVersion) return;
    if (selectedVersion === detail.currentVersion) {
      setVersionContent(detail.content);
      setDraftCode(detail.content);
      return;
    }
    fetch(
      `/api/artifacts/${encodeURIComponent(detail.id)}/versions/${selectedVersion}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.content === 'string') {
          setVersionContent(data.content);
          setDraftCode(data.content);
        }
      });
  }, [detail, selectedVersion]);

  // WebSocket live reload connection
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'artifact:created' || msg.type === 'artifact:updated') {
          fetchList();
          if (
            msg.artifact &&
            (msg.artifact.id === selectedId || msg.artifact.slug === selectedId)
          ) {
            fetchDetail(msg.artifact.id);
          }
        } else if (msg.type === 'artifact:deleted') {
          fetchList();
        } else if (msg.type === 'storage:updated') {
          if (
            detail &&
            (msg.artifactId === detail.id || msg.artifactId === detail.slug)
          ) {
            setStorageEntries(msg.entries || []);
          }
        }
      } catch {
        // Ignore malformed ws messages
      }
    };
    return () => ws.close();
  }, [fetchList, fetchDetail, selectedId, detail]);

  const viewVersion = detail
    ? selectedVersion ?? detail.currentVersion
    : 1;
  const isHistorical = Boolean(
    detail && viewVersion !== detail.currentVersion
  );
  const isDirty = Boolean(
    detail && !isHistorical && draftCode !== versionContent
  );

  const handleSaveIteration = useCallback(async () => {
    if (!detail || isHistorical || !isDirty) return;
    const nextVer = detail.currentVersion + 1;
    const res = await fetch(
      `/api/artifacts/${encodeURIComponent(detail.id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draftCode,
          agent: 'user',
          summary: commitSummary.trim() || 'Edited in studio',
        }),
      }
    );
    if (res.ok) {
      setCommitSummary('');
      await fetchDetail(detail.id);
      await fetchList();
      showToast(`Saved v${nextVer}`);
    }
  }, [detail, isHistorical, isDirty, draftCode, commitSummary, fetchDetail, fetchList, showToast]);

  const handleRollback = useCallback(
    async (targetVersion: number) => {
      if (!detail) return;
      const nextVer = detail.currentVersion + 1;
      const res = await fetch(
        `/api/artifacts/${encodeURIComponent(detail.id)}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: targetVersion, agent: 'user' }),
        }
      );
      if (res.ok) {
        await fetchDetail(detail.id);
        await fetchList();
        showToast(`Restored v${targetVersion} as v${nextVer}`);
      }
    },
    [detail, fetchDetail, fetchList, showToast]
  );

  const handleExportHtml = useCallback(() => {
    if (!detail) return;
    const url = `/api/artifacts/${encodeURIComponent(detail.id)}/export?version=${viewVersion}&download=1`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${detail.slug}-v${viewVersion}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${detail.slug}-v${viewVersion}.html`);
  }, [detail, viewVersion, showToast]);

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(versionContent);
    } catch {
      // Ignore clipboard permission errors
    }
    setMenuOpen(false);
    showToast(`Copied v${viewVersion} source`);
  }, [versionContent, viewVersion, showToast]);

  const handleCopyCli = useCallback(async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(`myartifact get ${detail.slug}`);
    } catch {
      // Ignore clipboard permission errors
    }
    setMenuOpen(false);
    showToast('Copied CLI command');
  }, [detail, showToast]);

  const handleCopyPageLink = useCallback(async () => {
    if (!detail) return;
    const url = `${window.location.origin}/artifacts/${detail.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Ignore clipboard permission errors
    }
    setMenuOpen(false);
    showToast(`Copied link: /artifacts/${detail.slug}`);
  }, [detail, showToast]);

  const handleAddStorageEntry = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const key = newStorageKey.trim();
    if (!detail || !key) return;
    const res = await fetch(
      `/api/artifacts/${encodeURIComponent(detail.id)}/storage`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newStorageValue }),
      }
    );
    if (res.ok) {
      setNewStorageKey('');
      setNewStorageValue('');
      await fetchDetail(detail.id, true);
      showToast(`Set ${key}`);
    }
  };

  const handleDeleteStorageKey = async (key: string) => {
    if (!detail) return;
    const res = await fetch(
      `/api/artifacts/${encodeURIComponent(detail.id)}/storage?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      await fetchDetail(detail.id, true);
      showToast(`Deleted key ${key}`);
    }
  };

  const handleCreateArtifact = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSubmitted(true);
    if (!newTitle.trim() || !newContent.trim()) return;

    const selectedTpl = KIT_TEMPLATES.find((t) => t.id === template);
    const detected = detectArtifactType(newContent);
    const resolvedType: ArtifactType =
      selectedTpl && selectedTpl.type !== 'any'
        ? selectedTpl.type
        : detected || 'code';

    const tags =
      template !== 'blank'
        ? [`template:${template}`, `theme:${themeId}`]
        : [];

    const res = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle.trim(),
        type: resolvedType,
        agent: 'user',
        content: newContent,
        tags,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setShowCreateModal(false);
      setSubmitted(false);
      setNewTitle('');
      setNewContent('');
      await fetchList();
      setSelectedId(data.artifact.id);
      setActiveTab('preview');
      showToast('Saved v1');
    }
  };

  const handleConfirmDelete = async () => {
    if (!detail || confirmDeleteText !== detail.slug) return;
    const deletedTitle = detail.title;
    const deletedId = detail.id;
    const res = await fetch(
      `/api/artifacts/${encodeURIComponent(deletedId)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      setDeleteOpen(false);
      setConfirmDeleteText('');
      const remaining = artifacts.filter((a) => a.id !== deletedId);
      setArtifacts(remaining);
      if (remaining.length > 0) {
        setSelectedId(remaining[0].id);
      } else {
        setDetail(null);
        setSelectedId(null);
      }
      showToast(`Deleted ${deletedTitle}`);
    }
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isTyping = Boolean(
        target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)
      );

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setVerOpen(false);
        setMenuOpen(false);
        setQuery('');
        setPaletteIndex(0);
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveIteration();
        return;
      }

      if (e.key === 'Escape') {
        if (zenMode) {
          setZenMode(false);
          return;
        }
        closeAllOverlays();
        return;
      }

      if (
        isTyping ||
        mod ||
        paletteOpen ||
        showCreateModal ||
        deleteOpen
      ) {
        return;
      }

      if (e.key === '1') setActiveTab('preview');
      else if (e.key === '2') setActiveTab('code');
      else if (e.key === '3') setActiveTab('diff');
      else if (e.key === '4') setActiveTab('storage');
      else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openCreateModal('blank');
      } else if (
        (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k') &&
        detail
      ) {
        const delta = e.key.toLowerCase() === 'j' ? -1 : 1;
        setSelectedVersion((prev) => {
          const cur = prev ?? detail.currentVersion;
          return Math.min(detail.currentVersion, Math.max(1, cur + delta));
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleSaveIteration,
    closeAllOverlays,
    openCreateModal,
    paletteOpen,
    showCreateModal,
    deleteOpen,
    detail,
  ]);

  useEffect(() => {
    if (paletteOpen) {
      setTimeout(() => paletteInputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  // Command palette items
  const paletteItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedArtifacts = artifacts
      .filter(
        (a) =>
          !q ||
          `${a.title} ${a.slug} ${a.tags.join(' ')}`
            .toLowerCase()
            .includes(q)
      )
      .map((a, idx) => {
        const typeInfo = TYPE_META[a.type] || TYPE_META.code;
        const agentInfo = getAgentInfo(a.agent);
        return {
          key: `art-${a.id}`,
          header: idx === 0 ? 'Artifacts' : '',
          label: a.title,
          meta: `v${a.currentVersion} · ${agentInfo.label}`,
          Icon: typeInfo.Icon,
          run: () => {
            setSelectedId(a.id);
            setPaletteOpen(false);
            setQuery('');
          },
        };
      });

    const rawActions = [
      {
        key: 'act-new',
        label: 'New artifact',
        meta: 'N',
        Icon: Plus,
        run: () => openCreateModal('blank'),
      },
      {
        key: 'act-theme',
        label:
          theme === 'night'
            ? 'Switch to day theme'
            : 'Switch to night theme',
        meta: '',
        Icon: theme === 'night' ? Sun : Moon,
        run: () => {
          setPaletteOpen(false);
          toggleTheme();
        },
      },
      {
        key: 'act-templates',
        label: 'Browse templates & themes',
        meta: '',
        Icon: Palette,
        run: () => openCreateModal('dashboard'),
      },
      {
        key: 'act-shortcuts',
        label: 'Toggle view shortcuts',
        meta: '1–4',
        Icon: CodeXml,
        run: () => {
          setPaletteOpen(false);
          setActiveTab((prev) =>
            prev === 'preview'
              ? 'code'
              : prev === 'code'
              ? 'diff'
              : prev === 'diff'
              ? 'storage'
              : 'preview'
          );
        },
      },
      {
        key: 'act-export',
        label: 'Export current as HTML',
        meta: '',
        Icon: Download,
        run: () => {
          setPaletteOpen(false);
          handleExportHtml();
        },
      },
    ].filter((act) => !q || act.label.toLowerCase().includes(q));

    const matchedActions = rawActions.map((act, idx) => ({
      ...act,
      header: idx === 0 ? 'Actions' : '',
    }));

    return [...matchedArtifacts, ...matchedActions];
  }, [
    artifacts,
    query,
    theme,
    openCreateModal,
    toggleTheme,
    handleExportHtml,
  ]);

  const safePaletteIndex = Math.min(
    paletteIndex,
    Math.max(0, paletteItems.length - 1)
  );

  // Storage metrics
  const totalStorageBytes = useMemo(
    () =>
      storageEntries.reduce(
        (sum, entry) => sum + new Blob([entry.value]).size,
        0
      ),
    [storageEntries]
  );

  // Editor metrics
  const lineCount = useMemo(
    () => Math.max(1, draftCode.split('\n').length),
    [draftCode]
  );
  const lineGutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount]
  );

  // New artifact dialog helpers
  const detectedNewType = useMemo(
    () => detectArtifactType(newContent),
    [newContent]
  );
  const createError = useMemo(() => {
    if (!submitted) return '';
    if (!newTitle.trim()) return 'Add a title.';
    if (!newContent.trim()) return 'Paste some source to create v1.';
    return '';
  }, [submitted, newTitle, newContent]);

  const detailAgent = detail ? getAgentInfo(detail.agent) : null;
  const detailType = detail
    ? TYPE_META[detail.type] || TYPE_META.code
    : TYPE_META.code;
  const displayFileName = detail
    ? `current.${detailType.ext}`
    : 'current.txt';
  const displayFilePath = detail
    ? `~/.myartifact/artifacts/${detail.slug}/${displayFileName}`
    : '';

  const viewportMaxWidth =
    viewport === 'tablet'
      ? '820px'
      : viewport === 'mobile'
      ? '390px'
      : '100%';
  const viewportLabel =
    viewport === 'tablet'
      ? '820 px'
      : viewport === 'mobile'
      ? '390 px'
      : 'Fill width';
  const DetailTypeIcon = detailType.Icon;
  const detailIconSvg = useMemo(
    () => (detail ? resolveArtifactIconSvg(detail) : null),
    [detail]
  );

  // ==========================================================================
  // STANDALONE CLAUDE ARTIFACT DETAIL PAGE (/artifacts/:slug or /?artifact=:slug)
  // ==========================================================================
  if (pageMode === 'artifact') {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-raised text-[13px] text-ink">
        {/* Floating exit pill when in Zen / Fullscreen mode */}
        {zenMode && (
          <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-raised/90 backdrop-blur border border-line-strong shadow-[0_6px_16px_rgba(30,36,32,0.14)]">
            {detail && (
              <span className="font-mono text-[11px] text-ink-2 px-1.5 truncate max-w-[200px]">
                {detail.title} · v{viewVersion}
              </span>
            )}
            <button
              onClick={() => setZenMode(false)}
              title="Exit fullscreen (Esc)"
              className="h-[24px] px-2 rounded-full bg-sage text-canvas text-[11px] font-medium flex items-center gap-1"
            >
              <Minimize2 className="w-3 h-3" />
              <span>Show bar</span>
            </button>
          </div>
        )}

        {/* Claude Artifact-style Compact Top Bar */}
        {!zenMode && (
          <header className="h-[52px] px-4 border-b border-line bg-raised flex items-center justify-between gap-3 shrink-0">
            {/* Left: Artifact Identity + Agent + Version */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <button
                onClick={() => navigateToStudio(detail?.slug || selectedId)}
                title="Open Managing Studio with all artifacts"
                className="h-[30px] px-2.5 rounded-[7px] bg-canvas hover:bg-sunken border border-line text-ink-2 hover:text-ink text-[12px] font-medium flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <ArrowLeft className="w-[13px] h-[13px]" />
                <span
                  className="w-[15px] h-[15px] inline-flex shrink-0 [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
                />
                <span className="hidden sm:inline">Studio</span>
              </button>

              <div className="h-4 w-px bg-line shrink-0" />

              {detail ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  {detailIconSvg ? (
                    <span
                      className="w-[30px] h-[30px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.12)] [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: detailIconSvg }}
                    />
                  ) : (
                    <span className="w-[30px] h-[30px] rounded-[7px] bg-sage-soft text-sage border border-[var(--c-sage-border)] flex items-center justify-center shrink-0">
                      <DetailTypeIcon className="w-[15px] h-[15px]" />
                    </span>
                  )}

                  <div className="min-w-0 flex flex-col leading-tight">
                    <div className="flex items-center gap-2 min-w-0">
                      <h1 className="m-0 text-[14.5px] font-semibold text-ink truncate">
                        {detail.title}
                      </h1>
                      <span className="hidden md:inline-block font-mono text-[11px] px-1.5 py-[1px] rounded bg-sunken text-ink-3 shrink-0">
                        {detailType.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11.5px] text-ink-2 truncate">
                      {detailAgent && (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-[6px] h-[6px] rounded-full"
                            style={{ background: detailAgent.dot }}
                          />
                          <span>{detailAgent.label}</span>
                        </span>
                      )}
                      <span>·</span>
                      <span className="font-mono text-[11px] text-ink-3 truncate">
                        {detail.slug}
                      </span>
                      <span>·</span>
                      <span>{formatRelativeTime(detail.updatedAt)}</span>
                      {wsConnected && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-[var(--c-live-ink)]">
                            <span className="w-[5px] h-[5px] rounded-full bg-[var(--c-live-dot)]" />
                            Live
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <span className="text-[13px] text-ink-2">
                  {notFoundSlug ? 'Artifact not found' : 'Loading artifact…'}
                </span>
              )}
            </div>

            {/* Center: Claude Artifact Segmented Mode Toggle (Preview | Code | Changes | State) */}
            {detail && (
              <div
                role="tablist"
                aria-label="Artifact view mode"
                className="inline-flex items-center p-[3px] rounded-[9px] bg-sunken border border-line shrink-0"
              >
                {(
                  [
                    { id: 'preview', label: 'Preview', Icon: Eye, badge: '' },
                    {
                      id: 'code',
                      label: 'Code',
                      Icon: CodeXml,
                      badge: isDirty ? '●' : '',
                    },
                    {
                      id: 'diff',
                      label: 'Changes',
                      Icon: GitCompare,
                      badge:
                        detail.currentVersion > 1
                          ? `v${detail.currentVersion}`
                          : '',
                    },
                    {
                      id: 'storage',
                      label: 'State',
                      Icon: Database,
                      badge:
                        storageEntries.length > 0
                          ? String(storageEntries.length)
                          : '',
                    },
                  ] as const
                ).map((tab) => {
                  const active = activeTab === tab.id;
                  const TabIcon = tab.Icon;
                  return (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setVerOpen(false);
                        setMenuOpen(false);
                      }}
                      className={`h-[28px] px-2.5 rounded-[6px] text-[12px] flex items-center gap-1.5 transition-all ${
                        active
                          ? 'bg-raised text-ink font-medium shadow-[0_1px_2px_rgba(30,36,32,0.08)]'
                          : 'bg-transparent text-ink-2 hover:text-ink'
                      }`}
                    >
                      <TabIcon className="w-[13px] h-[13px]" />
                      <span>{tab.label}</span>
                      {tab.badge && (
                        <span className="font-mono text-[10px] px-1 rounded bg-canvas text-ink-2">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Right: Version Picker, Viewport, Refresh, Copy, Export, Fullscreen */}
            {detail && (
              <div className="flex items-center justify-end gap-1.5 relative flex-1">
                {/* Responsive viewport switcher in Preview mode */}
                {activeTab === 'preview' && (
                  <div className="hidden lg:inline-flex p-0.5 bg-sunken rounded-[7px] border border-line gap-0.5">
                    {(
                      [
                        { id: 'desktop', label: 'Desktop (Full)', Icon: Monitor },
                        { id: 'tablet', label: 'Tablet (820px)', Icon: Tablet },
                        { id: 'mobile', label: 'Mobile (390px)', Icon: Smartphone },
                      ] as const
                    ).map((vp) => {
                      const active = viewport === vp.id;
                      const VpIcon = vp.Icon;
                      return (
                        <button
                          key={vp.id}
                          onClick={() => setViewport(vp.id)}
                          title={vp.label}
                          className={`w-[26px] h-[24px] rounded-[5px] flex items-center justify-center transition ${
                            active
                              ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(30,36,32,0.06)]'
                              : 'bg-transparent text-ink-2 hover:text-ink'
                          }`}
                        >
                          <VpIcon className="w-[13px] h-[13px]" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Reload Sandbox button (like Claude Artifact's refresh icon) */}
                {activeTab === 'preview' && (
                  <button
                    onClick={() => {
                      setReloadNonce((n) => n + 1);
                      showToast('Reloaded artifact preview');
                    }}
                    title="Reload artifact preview"
                    aria-label="Reload artifact preview"
                    className="w-[30px] h-[30px] rounded-[6px] border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink flex items-center justify-center transition-colors"
                  >
                    <RotateCw className="w-[13.5px] h-[13.5px]" />
                  </button>
                )}

                {/* Version Selector Dropdown */}
                <button
                  onClick={() => {
                    setVerOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                  aria-label="Version history"
                  className={`h-[30px] px-2.5 rounded-[6px] border border-line-strong text-[12px] font-medium whitespace-nowrap flex items-center gap-1.5 hover:bg-sunken transition-colors ${
                    isHistorical ? 'bg-brass-soft' : 'bg-raised'
                  }`}
                >
                  <History className="w-[13px] h-[13px] text-[var(--c-brass-icon)]" />
                  <span className="font-mono">
                    v{viewVersion}
                    <span className="text-ink-3 font-sans font-normal">
                      /{detail.currentVersion}
                    </span>
                  </span>
                  <ChevronDown className="w-3 h-3 text-ink-3" />
                </button>

                {/* Copy button (copies source in Code tab, or shareable artifact URL in Preview) */}
                <button
                  onClick={
                    activeTab === 'code' ? handleCopySource : handleCopyPageLink
                  }
                  title={
                    activeTab === 'code'
                      ? 'Copy artifact source code'
                      : 'Copy direct link to this artifact page'
                  }
                  className="h-[30px] px-2.5 rounded-[6px] border border-line bg-raised hover:bg-sunken text-ink-2 hover:text-ink text-[12px] font-medium hidden sm:flex items-center gap-1.5 transition-colors"
                >
                  {activeTab === 'code' ? (
                    <>
                      <Copy className="w-[13px] h-[13px]" />
                      <span>Copy code</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-[13px] h-[13px]" />
                      <span>Copy link</span>
                    </>
                  )}
                </button>

                {/* Export HTML */}
                <button
                  onClick={handleExportHtml}
                  title="Download standalone HTML file"
                  className="h-[30px] px-2.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[12px] font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-[13px] h-[13px]" />
                  <span className="hidden md:inline">Export</span>
                </button>

                {/* Theme toggle */}
                <button
                  onClick={toggleTheme}
                  title={
                    theme === 'night'
                      ? 'Switch to day theme'
                      : 'Switch to night theme'
                  }
                  className="w-[30px] h-[30px] rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors"
                >
                  {theme === 'night' ? (
                    <Sun className="w-[14px] h-[14px]" />
                  ) : (
                    <Moon className="w-[14px] h-[14px]" />
                  )}
                </button>

                {/* Fullscreen / Zen Mode */}
                {activeTab === 'preview' && (
                  <button
                    onClick={() => setZenMode(true)}
                    title="Fullscreen artifact view (Esc to exit)"
                    aria-label="Fullscreen artifact view"
                    className="w-[30px] h-[30px] rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors"
                  >
                    <Maximize2 className="w-[14px] h-[14px]" />
                  </button>
                )}

                {/* Version Popover */}
                {verOpen && (
                  <div className="absolute top-[38px] right-0 w-[320px] max-h-[420px] overflow-y-auto z-40 bg-raised border border-line rounded-[10px] shadow-[0_6px_16px_rgba(30,36,32,0.12)] p-1.5">
                    {[...detail.versions].reverse().map((v) => {
                      const isLatest = v.version === detail.currentVersion;
                      const isViewed = v.version === viewVersion;
                      const filledNode = isLatest || isViewed;
                      const tag = isLatest
                        ? 'LATEST'
                        : isViewed
                        ? 'VIEWING'
                        : '';
                      const vAgent = getAgentInfo(v.agent);

                      return (
                        <button
                          key={v.version}
                          onClick={() => {
                            setSelectedVersion(v.version);
                            setVerOpen(false);
                          }}
                          className={`grid grid-cols-[16px_minmax(0,1fr)] gap-[10px] px-2 rounded-[8px] text-left w-full hover:bg-canvas transition-colors ${
                            isViewed ? 'bg-brass-soft' : 'bg-transparent'
                          }`}
                        >
                          <span className="flex flex-col items-center self-stretch pt-[13px]">
                            <span
                              className={`w-[10px] h-[10px] rounded-full border-2 box-border ${
                                filledNode
                                  ? 'bg-brass border-brass'
                                  : 'bg-raised border-line-strong'
                              }`}
                            />
                          </span>
                          <span className="py-[9px] flex flex-col gap-[1px] min-w-0">
                            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                              <span>v{v.version}</span>
                              {tag && (
                                <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-brass-ink">
                                  {tag}
                                </span>
                              )}
                            </span>
                            <span className="text-[13px] text-ink-2 break-words">
                              {v.summary}
                            </span>
                            <span className="text-[12px] text-ink-3">
                              {vAgent.label} · {formatRelativeTime(v.createdAt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </header>
        )}

        {/* Historical Version Banner */}
        {detail && isHistorical && !zenMode && (
          <div className="flex items-center gap-[10px] px-5 py-2 bg-brass-soft border-b border-brass-line text-[13px] text-[var(--c-banner-ink)] shrink-0">
            <History className="w-[15px] h-[15px] text-[var(--c-brass-icon)] shrink-0" />
            <span className="flex-1">
              Viewing <strong className="font-semibold">v{viewVersion}</strong> of{' '}
              {detail.currentVersion} · read-only snapshot.
            </span>
            <button
              onClick={() => handleRollback(viewVersion)}
              className="h-[26px] px-2.5 rounded-[6px] bg-brass text-[#2A2110] text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90"
            >
              <RotateCcw className="w-[12px] h-[12px]" />
              <span>Restore as v{detail.currentVersion + 1}</span>
            </button>
            <button
              onClick={() => setSelectedVersion(detail.currentVersion)}
              className="h-[26px] px-2.5 rounded-[6px] border border-brass-line bg-raised text-brass-ink text-[12px] font-medium hover:bg-canvas"
            >
              Back to latest
            </button>
          </div>
        )}

        {/* Standalone Detail Body */}
        {detail ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* PREVIEW: Edge-to-edge full-screen in desktop mode (like Claude Artifact), or device frame for tablet/mobile */}
            {activeTab === 'preview' &&
              (viewport === 'desktop' ? (
                <div className="flex-1 min-h-0 w-full h-full bg-[#020617]">
                  <SandboxRenderer
                    key={`${detail.id}-${viewVersion}-${reloadNonce}`}
                    artifactId={detail.id}
                    title={detail.title}
                    type={detail.type}
                    language={detail.language}
                    content={versionContent}
                    storageEntries={storageEntries}
                    onStorageMutated={() => fetchDetail(detail.id, true)}
                  />
                </div>
              ) : (
                <div
                  className="flex-1 overflow-y-auto overflow-x-hidden p-6"
                  style={{
                    background:
                      'var(--color-sunken) radial-gradient(var(--color-line-strong) 1px, transparent 1px) 0 0 / 16px 16px',
                  }}
                >
                  <div
                    className="mx-auto rounded-[10px] overflow-hidden border border-line-strong shadow-[0_6px_16px_rgba(30,36,32,0.10)] bg-[#020617]"
                    style={{
                      maxWidth: viewportMaxWidth,
                      transition: 'max-width 0.25s ease',
                    }}
                  >
                    <div className="h-[30px] px-3 bg-raised border-b border-line flex items-center justify-between font-mono text-[11px] text-ink-3">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3 h-3 text-[var(--c-live-dot)]" />
                        <span>
                          {detail.slug}@v{viewVersion}
                        </span>
                      </span>
                      <span>{viewportLabel}</span>
                    </div>
                    <div className="h-[calc(100vh-120px)]">
                      <SandboxRenderer
                        key={`${detail.id}-${viewVersion}-${reloadNonce}`}
                        artifactId={detail.id}
                        title={detail.title}
                        type={detail.type}
                        language={detail.language}
                        content={versionContent}
                        storageEntries={storageEntries}
                        onStorageMutated={() => fetchDetail(detail.id, true)}
                      />
                    </div>
                  </div>
                </div>
              ))}

            {/* CODE TAB */}
            {activeTab === 'code' && (
              <div className="flex-1 min-h-0 flex flex-col bg-raised">
                <div className="h-[34px] px-5 border-b border-line bg-canvas flex items-center gap-2 font-mono text-[12px] text-ink-2 shrink-0">
                  <FileCode className="w-[14px] h-[14px] text-sage shrink-0" />
                  <span className="flex-1 truncate">{displayFilePath}</span>
                  <span className="text-ink-3 shrink-0 whitespace-nowrap">
                    {lineCount} lines · {detail.language || detailType.ext}
                  </span>
                </div>

                <div className="flex-1 min-h-0 overflow-auto flex items-start bg-raised">
                  <pre
                    aria-hidden="true"
                    className="m-0 pt-4 pr-3 pb-4 pl-5 font-mono text-[13px] leading-[20px] text-ink-4 text-right select-none sticky left-0 bg-raised min-h-full box-border"
                  >
                    {lineGutter}
                  </pre>
                  <textarea
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value)}
                    readOnly={isHistorical}
                    spellCheck={false}
                    rows={lineCount}
                    aria-label="Source editor"
                    className="flex-1 min-w-0 border-0 outline-none resize-none pt-4 pr-5 pb-4 pl-2 font-mono text-[13px] leading-[20px] bg-transparent text-ink whitespace-pre overflow-hidden"
                  />
                </div>

                <div className="px-5 py-2.5 border-t border-line bg-canvas flex items-center gap-2.5 shrink-0 flex-wrap">
                  <span
                    className={`flex items-center gap-1.5 text-[12px] min-w-[160px] ${
                      isDirty ? 'text-brass-ink' : 'text-ink-2'
                    }`}
                  >
                    <span
                      className="w-[7px] h-[7px] rounded-full"
                      style={{
                        background:
                          isDirty || isHistorical ? '#C8A96B' : '#8FA28A',
                      }}
                    />
                    {isHistorical
                      ? `Read-only · v${viewVersion}`
                      : isDirty
                      ? 'Unsaved changes'
                      : `No changes since v${detail.currentVersion}`}
                  </span>

                  <input
                    value={commitSummary}
                    onChange={(e) => setCommitSummary(e.target.value)}
                    placeholder="Describe this version (optional)"
                    disabled={!isDirty}
                    className="flex-1 min-w-[200px] h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised text-[13px] focus-moss disabled:opacity-60"
                  />

                  <button
                    onClick={() => {
                      setDraftCode(versionContent);
                      setCommitSummary('');
                    }}
                    disabled={!isDirty}
                    className="h-[32px] px-3 rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 text-[13px] font-medium disabled:opacity-40"
                  >
                    Discard
                  </button>

                  <button
                    onClick={handleSaveIteration}
                    disabled={!isDirty}
                    className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium flex items-center gap-2 disabled:opacity-40"
                  >
                    <span>Save as v{detail.currentVersion + 1}</span>
                    <kbd className="font-mono text-[11px] bg-canvas/15 rounded-[3px] px-1">
                      ⌘S
                    </kbd>
                  </button>
                </div>
              </div>
            )}

            {/* CHANGES / DIFF TAB */}
            {activeTab === 'diff' && (
              <DiffViewer
                artifactId={detail.id}
                fileName={displayFileName}
                versions={detail.versions}
                currentVersion={detail.currentVersion}
                hideUnchanged={hideUnchanged}
                onRollback={handleRollback}
              />
            )}

            {/* STATE / STORAGE TAB */}
            {activeTab === 'storage' && (
              <div className="flex-1 overflow-auto p-6">
                <div className="max-w-[880px] mx-auto flex flex-col gap-4">
                  <div className="flex items-end justify-between gap-4 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <h2 className="m-0 text-[14px] font-semibold text-ink">
                        window.storage
                      </h2>
                      <p className="m-0 text-[13px] text-ink-2 max-w-[560px]">
                        Persistent key-value state for{' '}
                        <code className="font-mono text-[12px] bg-sunken rounded-[4px] px-[5px] py-[1px]">
                          {detail.slug}
                        </code>
                        .
                      </p>
                    </div>
                    <span className="font-mono text-[12px] text-ink-3">
                      {formatBytes(totalStorageBytes)} of 20 MB
                    </span>
                  </div>

                  <div className="border border-line rounded-[10px] overflow-hidden bg-raised">
                    <div className="grid grid-cols-[200px_minmax(0,1fr)_80px_40px] gap-3 px-3.5 py-2 bg-canvas border-b border-line font-mono text-[11px] tracking-[0.06em] uppercase text-ink-3">
                      <span>Key</span>
                      <span>Value</span>
                      <span className="text-right">Size</span>
                      <span />
                    </div>

                    {storageEntries.length === 0 ? (
                      <div className="py-8 px-4 text-center text-[13px] text-ink-2 border-b border-line">
                        No persistent keys stored yet for this artifact.
                      </div>
                    ) : (
                      storageEntries.map((entry) => {
                        let pretty = entry.value;
                        try {
                          pretty = JSON.stringify(
                            JSON.parse(entry.value),
                            null,
                            2
                          );
                        } catch {
                          // Keep raw string
                        }
                        const byteLen = new Blob([entry.value]).size;
                        return (
                          <div
                            key={entry.key}
                            className="grid grid-cols-[200px_minmax(0,1fr)_80px_40px] gap-3 px-3.5 py-3 border-b border-line items-start"
                          >
                            <span className="font-mono text-[12.5px] font-medium text-sage-hover break-all">
                              {entry.key}
                            </span>
                            <pre className="m-0 font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-all text-ink bg-canvas rounded-[6px] px-2.5 py-2 max-h-[180px] overflow-auto">
                              {pretty}
                            </pre>
                            <span className="font-mono text-[12px] text-ink-3 text-right">
                              {formatBytes(byteLen)}
                            </span>
                            <button
                              onClick={() => handleDeleteStorageKey(entry.key)}
                              title="Delete key"
                              className="w-[28px] h-[28px] rounded-[6px] bg-transparent hover:bg-danger-soft text-ink-3 hover:text-danger-ink flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-[14px] h-[14px]" />
                            </button>
                          </div>
                        );
                      })
                    )}

                    <form
                      onSubmit={handleAddStorageEntry}
                      className="grid grid-cols-[200px_minmax(0,1fr)_auto] gap-3 px-3.5 py-3 bg-canvas items-center"
                    >
                      <input
                        value={newStorageKey}
                        onChange={(e) => setNewStorageKey(e.target.value)}
                        placeholder="key"
                        className="h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised font-mono text-[12.5px] focus-moss min-w-0"
                      />
                      <input
                        value={newStorageValue}
                        onChange={(e) => setNewStorageValue(e.target.value)}
                        placeholder="value · string or JSON"
                        className="h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised font-mono text-[12.5px] focus-moss min-w-0"
                      />
                      <button
                        type="submit"
                        disabled={!newStorageKey.trim()}
                        className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium disabled:opacity-40 transition"
                      >
                        Set key
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 bg-canvas">
            <div className="max-w-[400px] text-center flex flex-col gap-3 items-center">
              <div className="w-[44px] h-[44px] rounded-[10px] bg-sage-soft text-sage flex items-center justify-center">
                <Layers className="w-[22px] h-[22px]" />
              </div>
              <div className="text-[16px] font-semibold text-ink">
                {notFoundSlug
                  ? `Artifact “${notFoundSlug}” not found`
                  : 'Loading artifact…'}
              </div>
              {notFoundSlug && (
                <>
                  <div className="text-[13px] text-ink-2 leading-[1.55]">
                    This artifact slug may have been renamed or deleted. Open
                    the Studio to browse all local artifacts.
                  </div>
                  <button
                    onClick={() => navigateToStudio(null)}
                    className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium transition-colors"
                  >
                    Browse All Artifacts in Studio
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            role="status"
            className="fixed left-1/2 bottom-6 -translate-x-1/2 z-70 flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-ink text-canvas text-[13px] shadow-[0_6px_16px_rgba(30,36,32,0.24)] animate-toast-in"
          >
            <Check className="w-[15px] h-[15px] text-[#C7D3C0]" />
            <span>{toast}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas text-[13px] text-ink">
      {/* Sidebar */}
      <aside className="w-[272px] shrink-0 border-r border-line bg-canvas flex flex-col min-h-0">
        {/* 1. Brand row */}
        <div className="h-[56px] pl-4 pr-3 flex items-center justify-between border-b border-line shrink-0">
          <div className="flex items-center gap-[10px] min-w-0">
            <span
              className="w-[28px] h-[28px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.12)] [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: MYARTIFACT_LOGO_SVG }}
            />
            <div className="flex flex-col leading-[1.2] min-w-0 overflow-hidden">
              <span className="font-semibold text-[14px] text-ink">
                MyArtifact
              </span>
              {wsConnected ? (
                <span className="text-[11px] text-[var(--c-live-ink)] flex items-center gap-[5px] whitespace-nowrap">
                  <span className="w-[6px] h-[6px] rounded-full bg-[var(--c-live-dot)] shadow-[0_0_0_2px_var(--color-sage-soft)]" />
                  Live · :4173
                </span>
              ) : (
                <span className="text-[11px] text-ink-3 flex items-center gap-[5px] whitespace-nowrap">
                  <span className="w-[6px] h-[6px] rounded-full bg-ink-4" />
                  Offline
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={toggleTheme}
              title={
                theme === 'night'
                  ? 'Switch to day theme'
                  : 'Switch to night theme'
              }
              aria-label={
                theme === 'night'
                  ? 'Switch to day theme'
                  : 'Switch to night theme'
              }
              className="w-[28px] h-[28px] rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors"
            >
              {theme === 'night' ? (
                <Sun className="w-[15px] h-[15px]" />
              ) : (
                <Moon className="w-[15px] h-[15px]" />
              )}
            </button>
            <button
              onClick={() => openCreateModal('blank')}
              title="New artifact (N)"
              aria-label="New artifact"
              className="h-[28px] px-[10px] rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[12px] font-medium flex items-center gap-[5px] transition-colors"
            >
              <Plus className="w-[14px] h-[14px]" />
              New
            </button>
          </div>
        </div>

        {/* 2. Search trigger */}
        <div className="pt-3 px-3 pb-2 shrink-0">
          <button
            onClick={() => {
              setVerOpen(false);
              setMenuOpen(false);
              setQuery('');
              setPaletteIndex(0);
              setPaletteOpen(true);
            }}
            className="w-full h-[32px] pl-[10px] pr-2 rounded-[6px] bg-raised border border-line-strong hover:border-sage-focus flex items-center gap-2 text-left transition-colors"
          >
            <Search className="w-[14px] h-[14px] text-ink-3 shrink-0" />
            <span className="flex-1 text-ink-3 text-[13px] truncate">
              Search or jump to…
            </span>
            <kbd className="font-mono text-[11px] text-ink-2 bg-sunken border border-line border-b-2 rounded-[4px] px-[5px]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* 3. Artifact list */}
        <nav className="flex-1 overflow-y-auto pt-1 px-2 pb-3 flex flex-col gap-0.5">
          {artifacts.map((item) => {
            const selected = detail?.id === item.id || selectedId === item.id;
            const agentInfo = getAgentInfo(item.agent);
            const itemIconSvg = resolveArtifactIconSvg(item);

            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setVerOpen(false);
                  setMenuOpen(false);
                }}
                className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-[10px] items-center px-[10px] py-2 rounded-[8px] text-left w-full transition-colors ${
                  selected
                    ? 'bg-sage-soft shadow-[inset_2px_0_0_var(--color-sage)]'
                    : 'bg-transparent hover:bg-sunken'
                }`}
              >
                <span
                  className="w-[28px] h-[28px] rounded-[7px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.10)] [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: itemIconSvg }}
                />

                <span className="min-w-0 flex flex-col gap-[1px]">
                  <span className="text-[13px] font-medium truncate text-ink">
                    {item.title}
                  </span>
                  <span className="text-[12px] text-ink-2 flex items-center gap-1.5 whitespace-nowrap truncate">
                    <span
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ background: agentInfo.dot }}
                    />
                    {agentInfo.label} · {formatRelativeTime(item.updatedAt)}
                  </span>
                </span>

                <span
                  className={`font-mono text-[11px] rounded-[4px] px-1.5 py-[1px] ${
                    item.currentVersion > 1
                      ? 'bg-brass-soft text-brass-ink'
                      : 'bg-transparent text-ink-3'
                  }`}
                >
                  v{item.currentVersion}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Pane */}
      <main className="flex-1 min-w-0 flex flex-col bg-raised">
        {detail ? (
          <>
            {/* Main Header */}
            <header className="pt-[10px] px-5 pb-0 border-b border-line bg-raised flex flex-col gap-[10px] shrink-0">
              {/* Row 1 */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="min-w-0 flex items-center gap-[10px]">
                  {detailIconSvg && (
                    <span
                      className="w-[26px] h-[26px] rounded-[6px] overflow-hidden flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(30,36,32,0.10)] [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: detailIconSvg }}
                    />
                  )}
                  <h1 className="m-0 text-[17px] leading-[26px] font-semibold tracking-[-0.01em] truncate text-ink">
                    {detail.title}
                  </h1>
                  {detailAgent && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 whitespace-nowrap">
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{ background: detailAgent.dot }}
                      />
                      {detailAgent.label}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 relative shrink-0">
                  {/* Open Standalone Claude Artifact Page button */}
                  <button
                    onClick={() => navigateToArtifactPage(detail.slug)}
                    title="Open standalone Claude Artifact page (/artifacts/:slug)"
                    className="h-[32px] px-[10px] rounded-[6px] border border-line-strong bg-raised hover:bg-sunken text-ink text-[13px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-[14px] h-[14px] text-sage" />
                    <span>Artifact Page</span>
                  </button>

                  {/* Version button */}
                  <button
                    onClick={() => {
                      setVerOpen((v) => !v);
                      setMenuOpen(false);
                    }}
                    aria-label="Version history"
                    className={`h-[32px] px-[10px] rounded-[6px] border border-line-strong text-[13px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 hover:bg-sunken transition-colors ${
                      isHistorical ? 'bg-brass-soft' : 'bg-raised'
                    }`}
                  >
                    <History className="w-[14px] h-[14px] text-[var(--c-brass-icon)]" />
                    <span>
                      v{viewVersion}{' '}
                      <span className="text-ink-3 font-normal">
                        of {detail.currentVersion}
                      </span>
                    </span>
                    <ChevronDown className="w-3 h-3 text-ink-3" />
                  </button>

                  {/* Export button */}
                  <button
                    onClick={handleExportHtml}
                    className="h-[32px] px-3 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-[14px] h-[14px]" />
                    Export
                  </button>

                  {/* More button */}
                  <button
                    onClick={() => {
                      setMenuOpen((m) => !m);
                      setVerOpen(false);
                    }}
                    title="More"
                    aria-label="More actions"
                    className="w-[32px] h-[32px] rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 flex items-center justify-center transition-colors"
                  >
                    <Ellipsis className="w-4 h-4" />
                  </button>

                  {/* Version popover */}
                  {verOpen && (
                    <div className="absolute top-[38px] right-0 w-[320px] max-h-[420px] overflow-y-auto z-30 bg-raised border border-line rounded-[10px] shadow-[0_6px_16px_rgba(30,36,32,0.10)] p-1.5">
                      {[...detail.versions].reverse().map((v) => {
                        const isLatest = v.version === detail.currentVersion;
                        const isViewed = v.version === viewVersion;
                        const filledNode = isLatest || isViewed;
                        const tag = isLatest
                          ? 'LATEST'
                          : isViewed
                          ? 'VIEWING'
                          : '';
                        const vAgent = getAgentInfo(v.agent);

                        return (
                          <button
                            key={v.version}
                            onClick={() => {
                              setSelectedVersion(v.version);
                              setVerOpen(false);
                            }}
                            className={`grid grid-cols-[16px_minmax(0,1fr)] gap-[10px] px-2 rounded-[8px] text-left w-full hover:bg-canvas transition-colors ${
                              isViewed ? 'bg-brass-soft' : 'bg-transparent'
                            }`}
                          >
                            <span className="flex flex-col items-center self-stretch pt-[13px]">
                              <span
                                className={`w-[10px] h-[10px] rounded-full border-2 box-border ${
                                  filledNode
                                    ? 'bg-brass border-brass'
                                    : 'bg-raised border-line-strong'
                                }`}
                              />
                            </span>
                            <span className="py-[9px] flex flex-col gap-[1px] min-w-0">
                              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                <span>v{v.version}</span>
                                {tag && (
                                  <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-brass-ink">
                                    {tag}
                                  </span>
                                )}
                              </span>
                              <span className="text-[13px] text-ink-2 break-words">
                                {v.summary}
                              </span>
                              <span className="text-[12px] text-ink-3">
                                {vAgent.label} · {formatRelativeTime(v.createdAt)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* More menu */}
                  {menuOpen && (
                    <div className="absolute top-[38px] right-0 w-[220px] z-30 bg-raised border border-line rounded-[10px] shadow-[0_6px_16px_rgba(30,36,32,0.10)] p-1 flex flex-col">
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          navigateToArtifactPage(detail.slug);
                        }}
                        className="h-[32px] px-2 rounded-[6px] bg-transparent hover:bg-sunken flex items-center gap-2 text-[13px] text-left"
                      >
                        <ExternalLink className="w-[14px] h-[14px] text-ink-2" />
                        Open artifact page
                      </button>
                      <button
                        onClick={handleCopyPageLink}
                        className="h-[32px] px-2 rounded-[6px] bg-transparent hover:bg-sunken flex items-center gap-2 text-[13px] text-left"
                      >
                        <Link2 className="w-[14px] h-[14px] text-ink-2" />
                        Copy artifact link
                      </button>
                      <div className="h-px bg-line my-1" />
                      <button
                        onClick={handleCopySource}
                        className="h-[32px] px-2 rounded-[6px] bg-transparent hover:bg-sunken flex items-center gap-2 text-[13px] text-left"
                      >
                        <Copy className="w-[14px] h-[14px] text-ink-2" />
                        Copy source
                      </button>
                      <button
                        onClick={handleCopyCli}
                        className="h-[32px] px-2 rounded-[6px] bg-transparent hover:bg-sunken flex items-center gap-2 text-[13px] text-left"
                      >
                        <Terminal className="w-[14px] h-[14px] text-ink-2" />
                        Copy CLI command
                      </button>
                      <div className="h-px bg-line my-1" />
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDeleteText('');
                          setDeleteOpen(true);
                        }}
                        className="h-[32px] px-2 rounded-[6px] bg-transparent hover:bg-danger-soft text-danger-ink flex items-center gap-2 text-[13px] text-left"
                      >
                        <Trash2 className="w-[14px] h-[14px]" />
                        Delete…
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Tabs & Right Controls */}
              <div className="flex items-end justify-between gap-3">
                <div role="tablist" className="flex gap-5">
                  {(
                    [
                      { id: 'preview', label: 'Preview', badge: '' },
                      {
                        id: 'code',
                        label: 'Code',
                        badge: isDirty ? '●' : '',
                      },
                      {
                        id: 'diff',
                        label: 'Changes',
                        badge:
                          detail.currentVersion > 1
                            ? String(detail.currentVersion)
                            : '',
                      },
                      {
                        id: 'storage',
                        label: 'State',
                        badge:
                          storageEntries.length > 0
                            ? String(storageEntries.length)
                            : '',
                      },
                    ] as const
                  ).map((tab, idx) => {
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={active}
                        title={`${tab.label} (${idx + 1})`}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setMenuOpen(false);
                          setVerOpen(false);
                        }}
                        className={`h-[36px] p-0 border-0 bg-transparent border-b-2 -mb-px text-[13px] flex items-center gap-1.5 transition-colors ${
                          active
                            ? 'border-sage text-ink font-medium'
                            : 'border-transparent text-ink-2 font-normal hover:text-ink'
                        }`}
                      >
                        <span>{tab.label}</span>
                        {tab.badge && (
                          <span
                            className={`font-mono text-[11px] rounded-[4px] px-[5px] ${
                              tab.id === 'code'
                                ? 'bg-transparent text-brass'
                                : 'bg-sunken text-ink-2'
                            }`}
                          >
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="pb-1.5 flex items-center gap-2">
                  {activeTab === 'preview' && (
                    <div className="inline-flex p-0.5 bg-sunken rounded-[8px] gap-0.5">
                      {(
                        [
                          {
                            id: 'desktop',
                            label: 'Desktop · 100%',
                            Icon: Monitor,
                          },
                          {
                            id: 'tablet',
                            label: 'Tablet · 820px',
                            Icon: Tablet,
                          },
                          {
                            id: 'mobile',
                            label: 'Mobile · 390px',
                            Icon: Smartphone,
                          },
                        ] as const
                      ).map((vp) => {
                        const active = viewport === vp.id;
                        const VpIcon = vp.Icon;
                        return (
                          <button
                            key={vp.id}
                            onClick={() => setViewport(vp.id)}
                            title={vp.label}
                            aria-label={vp.label}
                            className={`w-[30px] h-[24px] rounded-[6px] flex items-center justify-center transition ${
                              active
                                ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(30,36,32,0.06)]'
                                : 'bg-transparent text-ink-2 hover:text-ink'
                            }`}
                          >
                            <VpIcon className="w-[14px] h-[14px]" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeTab === 'diff' && (
                    <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hideUnchanged}
                        onChange={(e) => setHideUnchanged(e.target.checked)}
                        className="m-0 accent-[var(--color-sage)]"
                      />
                      Collapse unchanged
                    </label>
                  )}
                </div>
              </div>
            </header>

            {/* Historical Banner */}
            {isHistorical && (
              <div className="flex items-center gap-[10px] px-5 py-2 bg-brass-soft border-b border-brass-line text-[13px] text-[var(--c-banner-ink)] shrink-0">
                <History className="w-[15px] h-[15px] text-[var(--c-brass-icon)] shrink-0" />
                <span className="flex-1">
                  Viewing <strong className="font-semibold">v{viewVersion}</strong>{' '}
                  of {detail.currentVersion} · read-only. Restoring creates v
                  {detail.currentVersion + 1}; nothing is overwritten.
                </span>
                <button
                  onClick={() => handleRollback(viewVersion)}
                  className="h-[28px] px-[10px] rounded-[6px] bg-brass text-[#2A2110] text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90"
                >
                  <RotateCcw className="w-[13px] h-[13px]" />
                  <span>Restore v{viewVersion}</span>
                </button>
                <button
                  onClick={() => setSelectedVersion(detail.currentVersion)}
                  className="h-[28px] px-[10px] rounded-[6px] border border-brass-line bg-raised text-brass-ink text-[12px] font-medium hover:bg-canvas"
                >
                  Back to latest
                </button>
              </div>
            )}

            {/* Tab Content */}
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Preview Tab */}
              {activeTab === 'preview' && (
                <div
                  className="flex-1 overflow-y-auto overflow-x-hidden p-6"
                  style={{
                    background:
                      'var(--color-sunken) radial-gradient(var(--color-line-strong) 1px, transparent 1px) 0 0 / 16px 16px',
                  }}
                >
                  <div
                    className="mx-auto rounded-[10px] overflow-hidden border border-line-strong shadow-[0_6px_16px_rgba(30,36,32,0.10)] bg-[#020617]"
                    style={{
                      maxWidth: viewportMaxWidth,
                      transition: 'max-width 0.25s ease',
                    }}
                  >
                    <div className="h-[30px] px-3 bg-raised border-b border-line flex items-center justify-between font-mono text-[11px] text-ink-3">
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        <ShieldCheck className="w-3 h-3 text-[var(--c-live-dot)] shrink-0" />
                        <span className="truncate">
                          sandbox · {detail.slug}@v{viewVersion}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap ml-2">
                        {viewportLabel}
                      </span>
                    </div>
                    <div className="min-h-[520px] h-[calc(100vh-170px)]">
                      <SandboxRenderer
                        artifactId={detail.id}
                        title={detail.title}
                        type={detail.type}
                        language={detail.language}
                        content={versionContent}
                        storageEntries={storageEntries}
                        onStorageMutated={() => fetchDetail(detail.id, true)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Code Tab */}
              {activeTab === 'code' && (
                <div className="flex-1 min-h-0 flex flex-col bg-raised">
                  {/* Path bar */}
                  <div className="h-[34px] px-5 border-b border-line bg-canvas flex items-center gap-2 font-mono text-[12px] text-ink-2 shrink-0">
                    <FileCode className="w-[14px] h-[14px] text-sage shrink-0" />
                    <span className="flex-1 truncate">{displayFilePath}</span>
                    <span className="text-ink-3 shrink-0 whitespace-nowrap">
                      {lineCount} lines · {detail.language || detailType.ext}
                    </span>
                  </div>

                  {/* Editor with sticky line numbers */}
                  <div className="flex-1 min-h-0 overflow-auto flex items-start bg-raised">
                    <pre
                      aria-hidden="true"
                      className="m-0 pt-4 pr-3 pb-4 pl-5 font-mono text-[13px] leading-[20px] text-ink-4 text-right select-none sticky left-0 bg-raised min-h-full box-border"
                    >
                      {lineGutter}
                    </pre>
                    <textarea
                      value={draftCode}
                      onChange={(e) => setDraftCode(e.target.value)}
                      readOnly={isHistorical}
                      spellCheck={false}
                      rows={lineCount}
                      aria-label="Source editor"
                      className="flex-1 min-w-0 border-0 outline-none resize-none pt-4 pr-5 pb-4 pl-2 font-mono text-[13px] leading-[20px] bg-transparent text-ink whitespace-pre overflow-hidden"
                    />
                  </div>

                  {/* Commit bar */}
                  <div className="px-5 py-2.5 border-t border-line bg-canvas flex items-center gap-2.5 shrink-0 flex-wrap">
                    <span
                      className={`flex items-center gap-1.5 text-[12px] min-w-[160px] ${
                        isDirty ? 'text-brass-ink' : 'text-ink-2'
                      }`}
                    >
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{
                          background:
                            isDirty || isHistorical ? '#C8A96B' : '#8FA28A',
                        }}
                      />
                      {isHistorical
                        ? `Read-only · v${viewVersion}`
                        : isDirty
                        ? 'Unsaved changes'
                        : `No changes since v${detail.currentVersion}`}
                    </span>

                    <input
                      value={commitSummary}
                      onChange={(e) => setCommitSummary(e.target.value)}
                      placeholder="Describe this version (optional)"
                      disabled={!isDirty}
                      className="flex-1 min-w-[200px] h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised text-[13px] focus-moss disabled:opacity-60"
                    />

                    <button
                      onClick={() => {
                        setDraftCode(versionContent);
                        setCommitSummary('');
                      }}
                      disabled={!isDirty}
                      className="h-[32px] px-3 rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 text-[13px] font-medium disabled:opacity-40"
                    >
                      Discard
                    </button>

                    <button
                      onClick={handleSaveIteration}
                      disabled={!isDirty}
                      className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium flex items-center gap-2 disabled:opacity-40"
                    >
                      <span>Save as v{detail.currentVersion + 1}</span>
                      <kbd className="font-mono text-[11px] bg-canvas/15 rounded-[3px] px-1">
                        ⌘S
                      </kbd>
                    </button>
                  </div>
                </div>
              )}

              {/* Changes Tab */}
              {activeTab === 'diff' && (
                <DiffViewer
                  artifactId={detail.id}
                  fileName={displayFileName}
                  versions={detail.versions}
                  currentVersion={detail.currentVersion}
                  hideUnchanged={hideUnchanged}
                  onRollback={handleRollback}
                />
              )}

              {/* State Tab */}
              {activeTab === 'storage' && (
                <div className="flex-1 overflow-auto p-6">
                  <div className="max-w-[880px] mx-auto flex flex-col gap-4">
                    <div className="flex items-end justify-between gap-4 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <h2 className="m-0 text-[14px] font-semibold text-ink">
                          window.storage
                        </h2>
                        <p className="m-0 text-[13px] text-ink-2 max-w-[560px]">
                          Keys this artifact saved with{' '}
                          <code className="font-mono text-[12px] bg-sunken rounded-[4px] px-[5px] py-[1px]">
                            window.storage.set()
                          </code>
                          . Stored in SQLite and mirrored to{' '}
                          <code className="font-mono text-[12px] bg-sunken rounded-[4px] px-[5px] py-[1px]">
                            state.json
                          </code>
                          .
                        </p>
                      </div>
                      <span className="font-mono text-[12px] text-ink-3">
                        {formatBytes(totalStorageBytes)} of 20 MB
                      </span>
                    </div>

                    <div className="border border-line rounded-[10px] overflow-hidden bg-raised">
                      <div className="grid grid-cols-[200px_minmax(0,1fr)_80px_40px] gap-3 px-3.5 py-2 bg-canvas border-b border-line font-mono text-[11px] tracking-[0.06em] uppercase text-ink-3">
                        <span>Key</span>
                        <span>Value</span>
                        <span className="text-right">Size</span>
                        <span />
                      </div>

                      {storageEntries.length === 0 ? (
                        <div className="py-8 px-4 text-center text-[13px] text-ink-2 border-b border-line">
                          No keys yet. The artifact writes here when it calls{' '}
                          <code className="font-mono text-[12px]">
                            window.storage.set
                          </code>
                          , or add one below.
                        </div>
                      ) : (
                        storageEntries.map((entry) => {
                          let pretty = entry.value;
                          try {
                            pretty = JSON.stringify(
                              JSON.parse(entry.value),
                              null,
                              2
                            );
                          } catch {
                            // Keep raw string value if not JSON
                          }
                          const byteLen = new Blob([entry.value]).size;
                          return (
                            <div
                              key={entry.key}
                              className="grid grid-cols-[200px_minmax(0,1fr)_80px_40px] gap-3 px-3.5 py-3 border-b border-line items-start"
                            >
                              <span className="font-mono text-[12.5px] font-medium text-sage-hover break-all">
                                {entry.key}
                              </span>
                              <pre className="m-0 font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-all text-ink bg-canvas rounded-[6px] px-2.5 py-2 max-h-[180px] overflow-auto">
                                {pretty}
                              </pre>
                              <span className="font-mono text-[12px] text-ink-3 text-right">
                                {formatBytes(byteLen)}
                              </span>
                              <button
                                onClick={() => handleDeleteStorageKey(entry.key)}
                                title="Delete key"
                                aria-label="Delete key"
                                className="w-[28px] h-[28px] rounded-[6px] bg-transparent hover:bg-danger-soft text-ink-3 hover:text-danger-ink flex items-center justify-center transition-colors"
                              >
                                <Trash2 className="w-[14px] h-[14px]" />
                              </button>
                            </div>
                          );
                        })
                      )}

                      <form
                        onSubmit={handleAddStorageEntry}
                        className="grid grid-cols-[200px_minmax(0,1fr)_auto] gap-3 px-3.5 py-3 bg-canvas items-center"
                      >
                        <input
                          value={newStorageKey}
                          onChange={(e) => setNewStorageKey(e.target.value)}
                          placeholder="key"
                          aria-label="New key"
                          className="h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised font-mono text-[12.5px] focus-moss min-w-0"
                        />
                        <input
                          value={newStorageValue}
                          onChange={(e) => setNewStorageValue(e.target.value)}
                          placeholder="value · string or JSON"
                          aria-label="New value"
                          className="h-[32px] px-2.5 rounded-[6px] border border-line-strong bg-raised font-mono text-[12.5px] focus-moss min-w-0"
                        />
                        <button
                          type="submit"
                          disabled={!newStorageKey.trim()}
                          className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium disabled:opacity-40 transition"
                        >
                          Set key
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Empty Main State */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-[380px] text-center flex flex-col gap-3 items-center">
              <div className="w-[44px] h-[44px] rounded-[10px] bg-sage-soft text-sage flex items-center justify-center">
                <Layers className="w-[22px] h-[22px]" />
              </div>
              <div className="text-[16px] font-semibold text-ink">
                No artifact open
              </div>
              <div className="text-[13px] text-ink-2 leading-[1.55]">
                Ask any connected assistant to create one, drop a file into{' '}
                <code className="font-mono text-[12px]">
                  ~/.myartifact/dropzone
                </code>
                , or start from scratch.
              </div>
              <button
                onClick={() => openCreateModal('blank')}
                className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium transition-colors"
              >
                New artifact
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Command Palette (⌘K) */}
      {paletteOpen && (
        <div
          onClick={closeAllOverlays}
          className="fixed inset-0 z-60 bg-[rgba(30,36,32,0.32)] flex justify-center items-start pt-[14vh]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Command palette"
            className="w-[min(560px,92vw)] bg-raised border border-line rounded-[14px] shadow-[0_20px_48px_rgba(30,36,32,0.18)] overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-4 h-[48px] border-b border-line">
              <Search className="w-4 h-4 text-ink-3 shrink-0" />
              <input
                ref={paletteInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPaletteIndex((i) =>
                      Math.min(paletteItems.length - 1, i + 1)
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPaletteIndex((i) => Math.max(0, i - 1));
                  } else if (
                    e.key === 'Enter' &&
                    paletteItems[safePaletteIndex]
                  ) {
                    e.preventDefault();
                    paletteItems[safePaletteIndex].run();
                  }
                }}
                placeholder="Search artifacts and actions"
                className="flex-1 border-0 outline-none bg-transparent text-[15px] text-ink"
              />
              <kbd className="font-mono text-[11px] text-ink-2 bg-sunken border border-line rounded-[4px] px-[5px]">
                esc
              </kbd>
            </div>

            <div className="max-h-[360px] overflow-y-auto p-1.5">
              {paletteItems.length === 0 ? (
                <div className="p-6 text-center text-ink-2">
                  Nothing matches “{query}”.
                </div>
              ) : (
                paletteItems.map((item, idx) => {
                  const ItemIcon = item.Icon;
                  const active = idx === safePaletteIndex;
                  return (
                    <div key={item.key} className="flex flex-col">
                      {item.header && (
                        <div className="pt-2 px-2.5 pb-1 font-mono text-[11px] tracking-[0.06em] uppercase text-ink-3">
                          {item.header}
                        </div>
                      )}
                      <button
                        onClick={item.run}
                        onMouseEnter={() => setPaletteIndex(idx)}
                        className={`h-[38px] px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13px] text-left w-full ${
                          active ? 'bg-sage-soft' : 'bg-transparent'
                        }`}
                      >
                        <ItemIcon className="w-[15px] h-[15px] text-ink-2 shrink-0" />
                        <span className="flex-1 truncate text-ink">
                          {item.label}
                        </span>
                        <span className="text-[12px] text-ink-3">
                          {item.meta}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex gap-4 px-4 py-2 border-t border-line bg-canvas text-[12px] text-ink-3">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>1–4 switch view</span>
            </div>
          </div>
        </div>
      )}

      {/* New Artifact Dialog */}
      {showCreateModal && (
        <div
          onClick={closeAllOverlays}
          className="fixed inset-0 z-60 bg-[rgba(30,36,32,0.32)] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="New artifact"
            className="w-[min(640px,100%)] bg-raised border border-line rounded-[14px] shadow-[0_20px_48px_rgba(30,36,32,0.18)] flex flex-col max-h-[90vh]"
          >
            <div className="pt-[18px] px-5 pb-0 flex items-start justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[16px] font-semibold text-ink">
                  New artifact
                </span>
                <span className="text-[13px] text-ink-2">
                  Saved to ~/.myartifact as v1.
                </span>
              </div>
              <button
                onClick={closeAllOverlays}
                aria-label="Close"
                className="w-[28px] h-[28px] rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5 overflow-y-auto overflow-x-hidden">
              {/* 1. Title */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Title</span>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Q4 Revenue Dashboard"
                  className={`h-[34px] px-2.5 rounded-[6px] border bg-raised text-[13px] focus-moss ${
                    submitted && !newTitle.trim()
                      ? 'border-danger'
                      : 'border-line-strong'
                  }`}
                />
                <span className="font-mono text-[11.5px] text-ink-3">
                  slug: {slugify(newTitle || 'untitled')}
                </span>
              </label>

              {/* 2. Start from */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2 flex justify-between">
                  <span>Start from</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextTpl =
                        template === 'blank' ? KIT_TEMPLATES[1] : KIT_TEMPLATES[1];
                      setTemplate(nextTpl.id);
                      if (!newTitle.trim()) setNewTitle(nextTpl.label);
                      setNewContent(
                        applyTemplateTheme(nextTpl.type, nextTpl.content, themeId)
                      );
                    }}
                    className="font-normal text-[12px] text-sage hover:underline bg-transparent border-0 p-0"
                  >
                    Browse templates →
                  </button>
                </span>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5">
                  {KIT_TEMPLATES.map((tpl) => {
                    const selected = template === tpl.id;
                    const TplIcon = TEMPLATE_ICONS[tpl.id];
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setTemplate(tpl.id);
                          if (tpl.id === 'blank') {
                            setNewContent('');
                          } else {
                            if (!newTitle.trim()) setNewTitle(tpl.label);
                            setNewContent(
                              applyTemplateTheme(
                                tpl.type,
                                tpl.content,
                                themeId
                              )
                            );
                          }
                        }}
                        className={`px-2.5 py-2 rounded-[8px] border flex flex-col items-start gap-1 text-left transition ${
                          selected
                            ? 'bg-sage-soft border-sage-focus font-medium'
                            : 'bg-raised border-line font-normal hover:bg-sunken'
                        }`}
                      >
                        <TplIcon className="w-[15px] h-[15px] text-sage" />
                        <span className="text-[13px] text-ink">{tpl.label}</span>
                        <span className="font-mono text-[11px] text-ink-3">
                          {tpl.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Theme */}
              {template !== 'blank' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-ink-2">
                    Theme
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.values(KIT_THEMES).map((th) => {
                      const selected = themeId === th.id;
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => {
                            setThemeId(th.id);
                            const currentTpl = KIT_TEMPLATES.find(
                              (t) => t.id === template
                            );
                            if (currentTpl && currentTpl.id !== 'blank') {
                              setNewContent(
                                applyTemplateTheme(
                                  currentTpl.type,
                                  currentTpl.content,
                                  th.id
                                )
                              );
                            }
                          }}
                          className={`h-[32px] pl-1.5 pr-2.5 rounded-full border flex items-center gap-2 text-[13px] transition ${
                            selected
                              ? 'bg-sage-soft border-sage-focus font-medium'
                              : 'bg-raised border-line font-normal hover:bg-sunken'
                          }`}
                        >
                          <span className="flex rounded-full overflow-hidden border border-[rgba(30,36,32,0.12)]">
                            <span
                              className="w-[10px] h-[20px]"
                              style={{ background: th.bg }}
                            />
                            <span
                              className="w-[10px] h-[20px]"
                              style={{ background: th.accent }}
                            />
                            <span
                              className="w-[10px] h-[20px]"
                              style={{ background: th.highlight }}
                            />
                          </span>
                          <span>{th.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. Source */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2 flex justify-between">
                  <span>Source</span>
                  <span className="font-normal text-[var(--c-live-ink)]">
                    {detectedNewType
                      ? `Detected ${TYPE_META[detectedNewType].label}`
                      : 'Type is detected from the source'}
                  </span>
                </span>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={9}
                  placeholder="Paste a React component, HTML page, Mermaid diagram, Markdown or SVG"
                  className={`box-border w-full min-w-0 p-2.5 rounded-[8px] border bg-canvas font-mono text-[12.5px] leading-[19px] resize-y focus-moss ${
                    submitted && !newContent.trim()
                      ? 'border-danger'
                      : 'border-line-strong'
                  }`}
                />
              </label>

              {createError && (
                <div className="text-[12px] text-danger-ink flex gap-1.5 items-center">
                  <CircleAlert className="w-[14px] h-[14px]" />
                  <span>{createError}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-canvas rounded-b-[14px]">
              <button
                type="button"
                onClick={closeAllOverlays}
                className="h-[32px] px-3 rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 text-[13px] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCreateArtifact()}
                className="h-[32px] px-3.5 rounded-[6px] bg-sage hover:bg-sage-hover text-canvas text-[13px] font-medium"
              >
                Create v1
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteOpen && detail && (
        <div
          onClick={closeAllOverlays}
          className="fixed inset-0 z-60 bg-[rgba(30,36,32,0.32)] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-label="Delete artifact"
            className="w-[min(440px,100%)] bg-raised border border-line rounded-[14px] shadow-[0_20px_48px_rgba(30,36,32,0.18)] p-5 flex flex-col gap-3.5"
          >
            <div className="flex gap-3 items-start">
              <div className="w-[32px] h-[32px] rounded-[8px] bg-danger-soft text-danger flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold text-ink">
                  Delete “{detail.title}”?
                </span>
                <span className="text-[13px] text-ink-2 leading-[1.55]">
                  This permanently removes {detail.currentVersion} versions and{' '}
                  {storageEntries.length} storage keys from disk. It can’t be
                  undone.
                </span>
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-[12px] text-ink-2">
              <span>
                Type{' '}
                <code className="font-mono text-ink">{detail.slug}</code> to
                confirm
              </span>
              <input
                value={confirmDeleteText}
                onChange={(e) => setConfirmDeleteText(e.target.value)}
                className="h-[34px] px-2.5 rounded-[6px] border border-line-strong bg-raised font-mono text-[12.5px] focus-danger"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAllOverlays}
                className="h-[32px] px-3 rounded-[6px] bg-transparent hover:bg-sunken text-ink-2 text-[13px] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={confirmDeleteText !== detail.slug}
                className="h-[32px] px-3.5 rounded-[6px] bg-danger text-raised text-[13px] font-medium disabled:opacity-40 transition"
              >
                Delete artifact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed left-1/2 bottom-6 -translate-x-1/2 z-70 flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-ink text-canvas text-[13px] shadow-[0_6px_16px_rgba(30,36,32,0.24)] animate-toast-in"
        >
          <Check className="w-[15px] h-[15px] text-[#C7D3C0]" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
