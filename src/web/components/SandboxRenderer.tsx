import React, { useEffect, useMemo, useRef } from 'react';
import { buildSandboxHtml } from '../../core/sandbox-template.js';
import type { ArtifactType, StorageEntry } from '../../core/types.js';

export interface SandboxRendererProps {
  artifactId: string;
  title: string;
  type: ArtifactType;
  language?: string;
  content: string;
  storageEntries: StorageEntry[];
  onStorageMutated?: () => void;
}

export const SandboxRenderer: React.FC<SandboxRendererProps> = ({
  artifactId,
  title,
  type,
  language,
  content,
  storageEntries,
  onStorageMutated,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const initialStorageMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of storageEntries) {
      map[e.key] = e.value;
    }
    return map;
  }, [artifactId]); // Only rebuild srcdoc when artifactId or content/type changes

  const srcDoc = useMemo(() => {
    return buildSandboxHtml({
      artifactId,
      title,
      type,
      language,
      content,
      initialStorage: initialStorageMap,
      standalone: false,
      theme: 'dark',
    });
  }, [artifactId, title, type, language, content, initialStorageMap]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'MYARTIFACT_STORAGE_REQ') return;
      if (data.artifactId !== artifactId) return;

      const { requestId, action, payload } = data;
      const reply = (result: unknown, error?: string) => {
        if (event.source && 'postMessage' in event.source) {
          (event.source as Window).postMessage(
            {
              type: 'MYARTIFACT_STORAGE_RES',
              requestId,
              result,
              error,
            },
            '*'
          );
        }
      };

      try {
        const base = `/api/artifacts/${encodeURIComponent(artifactId)}/storage`;
        if (action === 'get') {
          const res = await fetch(`${base}?key=${encodeURIComponent(payload.key)}`);
          const json = await res.json();
          reply(json.result ?? null);
        } else if (action === 'set') {
          const res = await fetch(base, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: payload.key, value: payload.value }),
          });
          const json = await res.json();
          onStorageMutated?.();
          reply(json.result);
        } else if (action === 'delete') {
          const res = await fetch(`${base}?key=${encodeURIComponent(payload.key)}`, {
            method: 'DELETE',
          });
          const json = await res.json();
          onStorageMutated?.();
          reply(json.result);
        } else if (action === 'list') {
          const res = await fetch(`${base}?prefix=${encodeURIComponent(payload.prefix || '')}`);
          const json = await res.json();
          reply(json.result);
        } else {
          reply(null, `Unsupported storage action: ${action}`);
        }
      } catch (err) {
        reply(null, err instanceof Error ? err.message : String(err));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [artifactId, onStorageMutated]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      className="w-full h-full border-0 bg-slate-950"
    />
  );
};
