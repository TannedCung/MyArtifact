import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Search,
  Code2,
  Eye,
  GitCompare,
  Database,
  Plus,
  Copy,
  Check,
  Download,
  History,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Trash2,
  Layers,
  Terminal,
  FileCode2,
  RefreshCw,
} from 'lucide-react';
import { SandboxRenderer } from './components/SandboxRenderer.js';
import { DiffViewer } from './components/DiffViewer.js';
import type {
  ArtifactDetail,
  ArtifactMetadata,
  ArtifactType,
  StorageEntry,
} from '../core/types.js';

type ActiveTab = 'preview' | 'code' | 'diff' | 'storage';

const AGENT_BADGES: Record<string, { label: string; color: string }> = {
  'claude-code': {
    label: 'Claude Code',
    color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  codex: {
    label: 'Codex',
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  antigravity: {
    label: 'Antigravity',
    color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  watcher: {
    label: 'Watched File',
    color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  user: {
    label: 'Local User',
    color: 'bg-slate-700/60 text-slate-300 border-slate-600',
  },
};

export default function App() {
  const [artifacts, setArtifacts] = useState<ArtifactMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [versionContent, setVersionContent] = useState<string>('');
  const [storageEntries, setStorageEntries] = useState<StorageEntry[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Code editor & UI state
  const [draftCode, setDraftCode] = useState<string>('');
  const [commitSummary, setCommitSummary] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Storage editor state
  const [newStorageKey, setNewStorageKey] = useState<string>('');
  const [newStorageValue, setNewStorageValue] = useState<string>('');

  // New Artifact modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newType, setNewType] = useState<ArtifactType>('react');
  const [newAgent, setNewAgent] = useState<string>('antigravity');
  const [newContent, setNewContent] = useState<string>('');

  const fetchList = useCallback(async () => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (agentFilter !== 'all') params.set('agent', agentFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);

    const res = await fetch(`/api/artifacts?${params.toString()}`);
    const data = await res.json();
    const list: ArtifactMetadata[] = data.artifacts || [];
    setArtifacts(list);

    if (!selectedId && list.length > 0) {
      const urlSlug = new URLSearchParams(window.location.search).get('artifact');
      const target = list.find((a) => a.slug === urlSlug || a.id === urlSlug) || list[0];
      setSelectedId(target.id);
    }
  }, [searchQuery, agentFilter, typeFilter, selectedId]);

  const fetchDetail = useCallback(async (id: string, preserveVersion = false) => {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = await res.json();
    const art: ArtifactDetail = data.artifact;
    setDetail(art);
    setStorageEntries(data.storage || []);
    if (!preserveVersion) {
      setSelectedVersion(art.currentVersion);
      setVersionContent(art.content);
      setDraftCode(art.content);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    }
  }, [selectedId, fetchDetail]);

  // Load historical version content when user steps back/forward in timeline
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
          if (detail && (msg.artifactId === detail.id || msg.artifactId === detail.slug)) {
            setStorageEntries(msg.entries || []);
          }
        }
      } catch {
        // Ignore malformed ws messages
      }
    };
    return () => ws.close();
  }, [fetchList, fetchDetail, selectedId, detail]);

  const handleSaveIteration = async () => {
    if (!detail) return;
    const res = await fetch(`/api/artifacts/${encodeURIComponent(detail.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: draftCode,
        agent: 'user',
        summary: commitSummary.trim() || `Edited in studio (v${detail.currentVersion + 1})`,
      }),
    });
    if (res.ok) {
      setCommitSummary('');
      await fetchDetail(detail.id);
      await fetchList();
      setActiveTab('preview');
    }
  };

  const handleRollback = async (targetVersion: number) => {
    if (!detail) return;
    const res = await fetch(`/api/artifacts/${encodeURIComponent(detail.id)}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: targetVersion, agent: 'user' }),
    });
    if (res.ok) {
      await fetchDetail(detail.id);
      await fetchList();
      setActiveTab('preview');
    }
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(versionContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleAddStorageEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !newStorageKey.trim()) return;
    await fetch(`/api/artifacts/${encodeURIComponent(detail.id)}/storage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: newStorageKey.trim(), value: newStorageValue }),
    });
    setNewStorageKey('');
    setNewStorageValue('');
    await fetchDetail(detail.id, true);
  };

  const handleDeleteStorageKey = async (key: string) => {
    if (!detail) return;
    await fetch(
      `/api/artifacts/${encodeURIComponent(detail.id)}/storage?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' }
    );
    await fetchDetail(detail.id, true);
  };

  const handleCreateArtifact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    const res = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle.trim(),
        type: newType,
        agent: newAgent,
        content: newContent,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setShowCreateModal(false);
      setNewTitle('');
      setNewContent('');
      await fetchList();
      setSelectedId(data.artifact.id);
    }
  };

  const handleDeleteArtifact = async () => {
    if (!detail) return;
    await fetch(`/api/artifacts/${encodeURIComponent(detail.id)}`, {
      method: 'DELETE',
    });
    setDetail(null);
    setSelectedId(null);
    await fetchList();
  };

  const badgeInfo = detail
    ? AGENT_BADGES[detail.agent] || {
        label: detail.agent,
        color: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
      }
    : null;

  const currentVersionObj = detail?.versions.find((v) => v.version === selectedVersion);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Left Library Sidebar */}
      <aside className="w-80 flex-shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight flex items-center gap-2">
                MyArtifact
                <span
                  title={wsConnected ? 'Live WebSocket Connected' : 'Offline'}
                  className={`w-2 h-2 rounded-full ${
                    wsConnected ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
              </div>
              <div className="text-[11px] text-slate-400">
                Claude Code • Codex • Antigravity
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
            title="New Artifact"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Agent Filters */}
        <div className="p-3 space-y-2.5 border-b border-slate-800/80">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, code, tags..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'claude-code', label: 'Claude Code' },
              { id: 'codex', label: 'Codex' },
              { id: 'antigravity', label: 'Antigravity' },
            ].map((ag) => (
              <button
                key={ag.id}
                onClick={() => setAgentFilter(ag.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  agentFilter === ag.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {ag.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {['all', 'react', 'html', 'mermaid', 'markdown', 'svg'].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono transition ${
                  typeFilter === t
                    ? 'bg-slate-800 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Artifact List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {artifacts.length === 0 ? (
            <div className="text-center py-12 px-4 text-xs text-slate-500">
              No artifacts match the current filter.
            </div>
          ) : (
            artifacts.map((item) => {
              const active = detail?.id === item.id;
              const badge = AGENT_BADGES[item.agent] || {
                label: item.agent,
                color: 'bg-slate-800 text-slate-300 border-slate-700',
              };
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    active
                      ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm'
                      : 'bg-slate-900/40 border-slate-800/70 hover:bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-xs text-slate-100 line-clamp-1">
                      {item.title}
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                      v{item.currentVersion}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                      {item.type}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer CLI/MCP hint */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 text-[11px] text-slate-400 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <code className="truncate">myartifact push &lt;file&gt; --agent ...</code>
        </div>
      </aside>

      {/* Main Artifact Workspace */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
        {!detail ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3">
            <Sparkles className="w-8 h-8 text-slate-700" />
            <p className="text-sm">Select or create an artifact to open the visual studio</p>
          </div>
        ) : (
          <>
            {/* Top Artifact Header & Version Bar */}
            <header className="px-6 py-3.5 border-b border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold text-white truncate">
                    {detail.title}
                  </h1>
                  {badgeInfo && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badgeInfo.color}`}
                    >
                      {badgeInfo.label}
                    </span>
                  )}
                  <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {detail.type}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                  <span className="font-mono text-slate-500">{detail.slug}</span>
                  {currentVersionObj && (
                    <span className="truncate">
                      • v{currentVersionObj.version}: {currentVersionObj.summary}
                    </span>
                  )}
                </div>
              </div>

              {/* Version Timeline Stepper + View Mode Tabs */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Version Stepper */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
                  <button
                    disabled={(selectedVersion || 1) <= 1}
                    onClick={() =>
                      setSelectedVersion((v) => Math.max(1, (v || 1) - 1))
                    }
                    className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                    title="Previous Version"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="px-2.5 flex items-center gap-1.5 font-mono">
                    <History className="w-3.5 h-3.5 text-indigo-400" />
                    <select
                      value={selectedVersion || detail.currentVersion}
                      onChange={(e) => setSelectedVersion(Number(e.target.value))}
                      className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {detail.versions.map((v) => (
                        <option
                          key={v.version}
                          value={v.version}
                          className="bg-slate-900 text-slate-100"
                        >
                          v{v.version} of {detail.currentVersion} ({v.agent})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    disabled={(selectedVersion || 1) >= detail.currentVersion}
                    onClick={() =>
                      setSelectedVersion((v) =>
                        Math.min(detail.currentVersion, (v || 1) + 1)
                      )
                    }
                    className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                    title="Next Version"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {selectedVersion && selectedVersion !== detail.currentVersion && (
                  <button
                    onClick={() => handleRollback(selectedVersion)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore v{selectedVersion}
                  </button>
                )}

                {/* Mode Tabs */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                      activeTab === 'preview'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                      activeTab === 'code'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Code
                  </button>
                  <button
                    onClick={() => setActiveTab('diff')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                      activeTab === 'diff'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    Diff
                  </button>
                  <button
                    onClick={() => setActiveTab('storage')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
                      activeTab === 'storage'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Database className="w-3.5 h-3.5" />
                    State ({storageEntries.length})
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopyCode}
                    className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                    title="Copy Source Code"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <a
                    href={`/api/artifacts/${encodeURIComponent(detail.id)}/export?version=${
                      selectedVersion || detail.currentVersion
                    }&download=1`}
                    className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                    title="Export Standalone Single-File HTML"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={handleDeleteArtifact}
                    className="p-2 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 text-slate-400 hover:text-rose-400"
                    title="Delete Artifact"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </header>

            {/* Tab Content Canvas */}
            <div className="flex-1 min-h-0 relative">
              {activeTab === 'preview' && (
                <SandboxRenderer
                  artifactId={detail.id}
                  title={detail.title}
                  type={detail.type}
                  language={detail.language}
                  content={versionContent}
                  storageEntries={storageEntries}
                  onStorageMutated={() => fetchDetail(detail.id, true)}
                />
              )}

              {activeTab === 'code' && (
                <div className="flex flex-col h-full bg-slate-950">
                  <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/70 border-b border-slate-800 text-xs">
                    <div className="flex items-center gap-2 text-slate-400 font-mono">
                      <FileCode2 className="w-4 h-4 text-indigo-400" />
                      <span>{detail.filePath}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={commitSummary}
                        onChange={(e) => setCommitSummary(e.target.value)}
                        placeholder="Version summary (optional)..."
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1 text-xs w-64 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={handleSaveIteration}
                        disabled={draftCode === detail.content}
                        className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition"
                      >
                        Save as v{detail.currentVersion + 1}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full p-5 bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed focus:outline-none resize-none"
                  />
                </div>
              )}

              {activeTab === 'diff' && (
                <DiffViewer
                  artifactId={detail.id}
                  versions={detail.versions}
                  currentVersion={detail.currentVersion}
                  onRollback={handleRollback}
                />
              )}

              {activeTab === 'storage' && (
                <div className="p-6 max-w-4xl mx-auto space-y-6 overflow-y-auto h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <Database className="w-4 h-4 text-indigo-400" />
                        Persistent Artifact Storage (window.storage)
                      </h2>
                      <p className="text-xs text-slate-400 mt-1">
                        Data saved by this artifact via{' '}
                        <code className="text-indigo-300">
                          await window.storage.set(key, value)
                        </code>{' '}
                        is persisted locally to SQLite and{' '}
                        <code className="text-slate-300">state.json</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => fetchDetail(detail.id, true)}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                      title="Refresh Storage"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>

                  <form
                    onSubmit={handleAddStorageEntry}
                    className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800"
                  >
                    <input
                      value={newStorageKey}
                      onChange={(e) => setNewStorageKey(e.target.value)}
                      placeholder="Key (e.g. user_prefs)"
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      value={newStorageValue}
                      onChange={(e) => setNewStorageValue(e.target.value)}
                      placeholder="Value (string or JSON)"
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-xs font-medium"
                    >
                      Set Key-Value
                    </button>
                  </form>

                  <div className="space-y-2">
                    {storageEntries.length === 0 ? (
                      <div className="text-center py-10 bg-slate-900/30 rounded-xl border border-slate-800/80 text-xs text-slate-500">
                        No persistent keys stored yet for this artifact.
                      </div>
                    ) : (
                      storageEntries.map((entry) => (
                        <div
                          key={entry.key}
                          className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="text-xs font-mono font-semibold text-indigo-300">
                              {entry.key}
                            </div>
                            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                              {entry.value}
                            </pre>
                          </div>
                          <button
                            onClick={() => handleDeleteStorageKey(entry.key)}
                            className="p-1.5 text-slate-500 hover:text-rose-400"
                            title="Delete Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* New Artifact Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateArtifact}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl"
          >
            <h2 className="text-base font-bold text-white">Create Local Artifact</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <input
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Artifact Title"
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as ArtifactType)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
              >
                <option value="react">React (.tsx / .jsx)</option>
                <option value="html">HTML / JS / CSS</option>
                <option value="mermaid">Mermaid Diagram</option>
                <option value="markdown">Markdown Document</option>
                <option value="svg">SVG Vector</option>
                <option value="code">Code Snippet</option>
              </select>
              <select
                value={newAgent}
                onChange={(e) => setNewAgent(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
              >
                <option value="antigravity">Antigravity</option>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="user">Local User</option>
              </select>
            </div>
            <textarea
              required
              rows={12}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Paste React component, HTML, Mermaid diagram, or Markdown..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              >
                Create Artifact
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
