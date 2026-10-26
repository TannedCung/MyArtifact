import React, { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { GitCompare, ArrowRight, RotateCcw } from 'lucide-react';
import type { ArtifactVersion } from '../../core/types.js';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  watcher: 'Watched file',
  user: 'You',
};

function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent] || agent;
}

export interface DiffViewerProps {
  artifactId: string;
  fileName?: string;
  versions: ArtifactVersion[];
  currentVersion: number;
  hideUnchanged?: boolean;
  onRollback: (version: number) => void;
}

interface DiffRow {
  type: '+' | '-' | ' ' | '…';
  oldLine: string;
  newLine: string;
  text: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  artifactId,
  fileName = 'current',
  versions,
  currentVersion,
  hideUnchanged = true,
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
    if (fromVer === toVer) {
      setLoading(false);
      return;
    }
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

  const { rows, addedLines, removedLines } = useMemo(() => {
    if (fromVer === toVer) {
      return { rows: [] as DiffRow[], addedLines: 0, removedLines: 0 };
    }
    const changes = diffLines(fromContent, toContent);
    const rawRows: DiffRow[] = [];
    let oldNum = 1;
    let newNum = 1;
    let added = 0;
    let removed = 0;

    for (const part of changes) {
      if (!part.value) continue;
      const lines = part.value.replace(/\n$/, '').split('\n');
      for (const line of lines) {
        if (part.added) {
          added++;
          rawRows.push({
            type: '+',
            oldLine: '',
            newLine: String(newNum++),
            text: line,
          });
        } else if (part.removed) {
          removed++;
          rawRows.push({
            type: '-',
            oldLine: String(oldNum++),
            newLine: '',
            text: line,
          });
        } else {
          rawRows.push({
            type: ' ',
            oldLine: String(oldNum++),
            newLine: String(newNum++),
            text: line,
          });
        }
      }
    }

    if (!hideUnchanged) {
      return { rows: rawRows, addedLines: added, removedLines: removed };
    }

    const keep = rawRows.map((_, i) =>
      rawRows.slice(Math.max(0, i - 3), i + 4).some((x) => x.type !== ' ')
    );
    const collapsed: DiffRow[] = [];
    let skipped = 0;

    rawRows.forEach((row, idx) => {
      if (keep[idx]) {
        if (skipped > 0) {
          collapsed.push({
            type: '…',
            oldLine: '',
            newLine: '',
            text: `⋯ ${skipped} unchanged lines`,
          });
          skipped = 0;
        }
        collapsed.push(row);
      } else {
        skipped++;
      }
    });

    if (skipped > 0) {
      collapsed.push({
        type: '…',
        oldLine: '',
        newLine: '',
        text: `⋯ ${skipped} unchanged lines`,
      });
    }

    return { rows: collapsed, addedLines: added, removedLines: removed };
  }, [fromContent, toContent, fromVer, toVer, hideUnchanged]);

  const canRestore = fromVer !== currentVersion && fromVer !== toVer;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-raised text-[13px]">
      {/* Toolbar */}
      <div className="px-5 py-2.5 border-b border-line bg-canvas flex items-center gap-2.5 flex-wrap shrink-0">
        <select
          aria-label="Base version"
          value={fromVer}
          onChange={(e) => setFromVer(Number(e.target.value))}
          className="h-[30px] px-2 rounded-[6px] border border-line-strong bg-raised text-[13px] text-ink focus-moss"
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version} · {getAgentLabel(v.agent)}
            </option>
          ))}
        </select>

        <ArrowRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />

        <select
          aria-label="Compare version"
          value={toVer}
          onChange={(e) => setToVer(Number(e.target.value))}
          className="h-[30px] px-2 rounded-[6px] border border-line-strong bg-raised text-[13px] text-ink focus-moss"
        >
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version} · {getAgentLabel(v.agent)}
            </option>
          ))}
        </select>

        <span className="flex-1" />

        <span className="font-mono text-[12px] text-add-ink bg-add rounded-[4px] px-[7px] py-[2px]">
          +{addedLines}
        </span>
        <span className="font-mono text-[12px] text-danger-ink bg-danger-soft rounded-[4px] px-[7px] py-[2px]">
          −{removedLines}
        </span>

        {canRestore && (
          <button
            onClick={() => onRollback(fromVer)}
            className="h-[30px] px-2.5 rounded-[6px] bg-brass-soft text-brass-ink text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition"
          >
            <RotateCcw className="w-[13px] h-[13px]" />
            <span>Restore v{fromVer}</span>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading ? (
          <div className="py-12 px-4 text-center text-ink-2 text-[13px]">
            Computing version diff…
          </div>
        ) : fromVer === toVer ? (
          <div className="py-12 px-4 text-center flex flex-col gap-1.5 items-center text-ink-2">
            <GitCompare className="w-[22px] h-[22px] text-ink-4" />
            <div className="font-medium text-ink">Pick two different versions</div>
            <div className="text-[12px]">Both sides are v{fromVer}.</div>
          </div>
        ) : (
          <div className="border border-line rounded-[10px] overflow-hidden font-mono text-[12.5px] leading-[20px]">
            <div className="px-3 py-1.5 bg-canvas border-b border-line text-ink-2 text-[12px]">
              {fileName}
            </div>
            {rows.map((r, idx) => {
              const rowClass =
                r.type === '+'
                  ? 'bg-add text-add-ink'
                  : r.type === '-'
                  ? 'bg-del text-del-ink'
                  : r.type === '…'
                  ? 'bg-canvas text-ink-3'
                  : 'bg-transparent text-ink-2';

              const signClass =
                r.type === '+'
                  ? 'text-sage'
                  : r.type === '-'
                  ? 'text-danger'
                  : 'text-ink-3';

              return (
                <div
                  key={idx}
                  className={`grid grid-cols-[44px_44px_20px_minmax(0,1fr)] ${rowClass}`}
                >
                  <span className="text-right pr-2 text-ink-4 select-none">
                    {r.oldLine}
                  </span>
                  <span className="text-right pr-2 text-ink-4 select-none border-r border-line">
                    {r.newLine}
                  </span>
                  <span className={`text-center select-none ${signClass}`}>
                    {r.type === '…' ? '' : r.type}
                  </span>
                  <span className="whitespace-pre-wrap break-all pr-3">
                    {r.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
