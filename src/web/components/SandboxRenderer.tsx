import React, { useEffect, useMemo, useRef } from 'react';
import { buildSandboxHtml } from '../../core/sandbox-template.js';
import { buildCloudHeaders } from '../cloud-api.js';
import type { ArtifactType, StorageEntry } from '../../core/types.js';

export interface SandboxRendererProps {
  artifactId: string;
  title: string;
  type: ArtifactType;
  language?: string;
  content: string;
  storageEntries: StorageEntry[];
  readOnlyStorage?: boolean;
  workspaceId?: string | null;
  shareToken?: string | null;
  onStorageMutated?: () => void;
}

export const SandboxRenderer: React.FC<SandboxRendererProps> = ({
  artifactId,
  title,
  type,
  language,
  content,
  storageEntries,
  readOnlyStorage = false,
  workspaceId,
  shareToken,
  onStorageMutated,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const cowCacheRef = useRef<Map<string, string>>(new Map());

  const initialStorageMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of storageEntries) {
      map[e.key] = e.value;
    }
    return map;
  }, [artifactId]); // Only rebuild srcdoc when artifactId or content/type changes

  // Seed Copy-on-Write viewer storage overlay (in-memory + sessionStorage)
  useEffect(() => {
    const nextMap = new Map<string, string>();
    for (const e of storageEntries) {
      nextMap.set(e.key, e.value);
    }
    try {
      const prefix = `ma_cow_${artifactId}:`;
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const val = sessionStorage.getItem(k);
          if (val !== null) {
            nextMap.set(k.slice(prefix.length), val);
          }
        }
      }
    } catch {
      // Ignore sessionStorage errors
    }
    cowCacheRef.current = nextMap;
  }, [artifactId, storageEntries]);

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
      // Strictly verify message originates from our active sandboxed iframe
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'MYARTIFACT_STORAGE_REQ') return;
      if (data.artifactId !== artifactId) return;

      const { requestId, action } = data;
      const safePayload =
        data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : {};
      const asString = (val: unknown): string =>
        typeof val === 'string'
          ? val
          : val == null || typeof val === 'object' || typeof val === 'symbol'
            ? ''
            : String(val);

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

      if (action === 'get' || action === 'set' || action === 'delete') {
        if (typeof safePayload.key !== 'string' && typeof safePayload.key !== 'number') {
          reply(null, 'Invalid storage key');
          return;
        }
      }

      const key = asString(safePayload.key);
      const value = asString(safePayload.value);
      const prefix = asString(safePayload.prefix);

      // Smooth Copy-on-Write ephemeral storage for Viewers & Share Links
      if (readOnlyStorage) {
        const cowPrefix = `ma_cow_${artifactId}:`;
        if (action === 'get') {
          const val = cowCacheRef.current.get(key);
          reply(val !== undefined ? { key, value: val } : null);
        } else if (action === 'set') {
          cowCacheRef.current.set(key, value);
          try {
            sessionStorage.setItem(cowPrefix + key, value);
          } catch {
            // Ignore quota errors
          }
          reply({ key, value });
        } else if (action === 'delete') {
          const existed = cowCacheRef.current.delete(key);
          try {
            sessionStorage.removeItem(cowPrefix + key);
          } catch {
            // Ignore
          }
          reply({ key, deleted: existed });
        } else if (action === 'list') {
          const keys = Array.from(cowCacheRef.current.keys())
            .filter((k) => k.startsWith(prefix))
            .sort();
          reply({ keys, prefix });
        } else {
          reply(null, `Unsupported storage action: ${action}`);
        }
        return;
      }

      try {
        const base = `/api/artifacts/${encodeURIComponent(artifactId)}/storage`;
        const reqCtx = { workspaceId, shareToken };
        if (action === 'get') {
          const res = await fetch(`${base}?key=${encodeURIComponent(key)}`, {
            credentials: 'same-origin',
            headers: buildCloudHeaders(reqCtx),
          });
          const json = await res.json();
          reply(json.result ?? null);
        } else if (action === 'set') {
          const res = await fetch(base, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: buildCloudHeaders(reqCtx, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ key, value }),
          });
          const json = await res.json();
          if (!res.ok) {
            reply(null, json.error || `HTTP ${res.status}`);
            return;
          }
          onStorageMutated?.();
          reply(json.result);
        } else if (action === 'delete') {
          const res = await fetch(`${base}?key=${encodeURIComponent(key)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: buildCloudHeaders(reqCtx),
          });
          const json = await res.json();
          if (!res.ok) {
            reply(null, json.error || `HTTP ${res.status}`);
            return;
          }
          onStorageMutated?.();
          reply(json.result);
        } else if (action === 'list') {
          const res = await fetch(`${base}?prefix=${encodeURIComponent(prefix)}`, {
            credentials: 'same-origin',
            headers: buildCloudHeaders(reqCtx),
          });
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
  }, [artifactId, readOnlyStorage, workspaceId, shareToken, onStorageMutated]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock"
      className="w-full min-h-[520px] h-full border-0 bg-[#020617] block"
    />
  );
};
