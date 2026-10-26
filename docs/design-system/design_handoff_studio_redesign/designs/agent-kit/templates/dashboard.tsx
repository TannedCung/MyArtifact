// @title: Weekly Metrics Dashboard
// @description: KPI row, one trend chart and a persistent notes panel
// @tags: template:dashboard, theme:moss
import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Plus, Check, Trash2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/* theme:start */
const THEME = { name: 'moss', grid: '#E2DDD0', axis: '#4A524A', surface: '#FCFBF7', chart: ['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A'] };
const THEME_CSS = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}`;
/* theme:end */

const BASE_CSS = `body{margin:0;background:var(--ma-bg);color:var(--ma-ink);font-family:var(--ma-font-sans);-webkit-font-smoothing:antialiased}`;

// Replace with real data. 4–8 points reads best.
const SERIES = [
  { label: 'Mon', value: 14200 },
  { label: 'Tue', value: 21500 },
  { label: 'Wed', value: 18900 },
  { label: 'Thu', value: 32400 },
  { label: 'Fri', value: 28100 },
  { label: 'Sat', value: 35900 },
  { label: 'Sun', value: 41200 },
];
// 2–4 KPIs. delta is % change; negative renders in --ma-danger.
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
              <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${k.delta >= 0 ? 'text-[var(--ma-accent)]' : 'text-[var(--ma-danger)]'}`}>
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
                  <Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.grid}`, borderRadius: 8, fontSize: 12 }} />
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
                  className={`h-4 w-4 grid place-items-center rounded border ${n.done ? 'bg-[var(--ma-accent)] border-[var(--ma-accent)] text-[var(--ma-accent-ink)]' : 'border-[var(--ma-muted)]'}`}>
                  {n.done && <Check size={12} />}
                </button>
                <span className={`flex-1 ${n.done ? 'line-through text-[var(--ma-muted)]' : ''}`}>{n.text}</span>
                <button aria-label="Delete note" onClick={() => save(notes.filter((x) => x.id !== n.id))} className="text-[var(--ma-muted)] hover:text-[var(--ma-danger)]"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
