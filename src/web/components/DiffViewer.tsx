import React, { useEffect, useState } from 'react';
import { diffLines } from 'diff';
import { GitCompare, ArrowRight, RotateCcw } from 'lucide-react';
import type { ArtifactVersion } from '../../core/types.js';

export interface DiffViewerProps {
  artifactId: string;
  versions: ArtifactVersion[];
  currentVersion: number;
  onRollback: (version: number) => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  artifactId,
  versions,
  currentVersion,
  onRollback,
}) => {
  const [fromVer, setFromVer] = useState<number>(Math.max(1, currentVersion - 1));
  const [toVer, setToVer] = useState<number>(currentVersion);
  const [fromContent, setFromContent] = useState<string>('');
  const [toContent, setToContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setToVer(currentVersion);
    setFromVer(Math.max(1, currentVersion - 1));
  }, [artifactId, currentVersion]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(
      `/api/artifacts/${encodeURIComponent(artifactId)}/diff?from=${fromVer}&to=${toVer}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setFromContent(data.fromContent || '');
        setToContent(data.toContent || '');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId, fromVer, toVer]);

  const changes = diffLines(fromContent, toContent);
  let addedLines = 0;
  let removedLines = 0;
  for (const part of changes) {
    const count = part.count || 0;
    if (part.added) addedLines += count;
    if (part.removed) removedLines += count;
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 bg-slate-900/80 border-b border-slate-800">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-slate-300">
            <GitCompare className="w-4 h-4 text-indigo-400" />
            Compare Versions:
          </span>
          <select
            value={fromVer}
            onChange={(e) => setFromVer(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} — {v.agent} ({v.summary.slice(0, 32)})
              </option>
            ))}
          </select>
          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={toVer}
            onChange={(e) => setToVer(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} — {v.agent} ({v.summary.slice(0, 32)})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            +{addedLines} lines
          </span>
          <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
            -{removedLines} lines
          </span>
          {fromVer !== currentVersion && (
            <button
              onClick={() => onRollback(fromVer)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore v{fromVer}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed p-4">
        {loading ? (
          <div className="text-slate-500 p-4">Computing version diff...</div>
        ) : fromVer === toVer ? (
          <div className="text-slate-400 p-6 text-center">
            Select two different versions above to inspect changes.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/40">
            {changes.map((part, idx) => {
              const bgClass = part.added
                ? 'bg-emerald-950/50 text-emerald-200 border-l-2 border-emerald-500'
                : part.removed
                ? 'bg-rose-950/50 text-rose-200 border-l-2 border-rose-500'
                : 'text-slate-400';
              const prefix = part.added ? '+' : part.removed ? '-' : ' ';
              const lines = part.value.replace(/\n$/, '').split('\n');
              return (
                <div key={idx} className={bgClass}>
                  {lines.map((line, lineIdx) => (
                    <div
                      key={lineIdx}
                      className="px-4 py-0.5 whitespace-pre-wrap break-all flex gap-3"
                    >
                      <span className="select-none opacity-60 w-3 inline-block">{prefix}</span>
                      <span className="flex-1">{line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
