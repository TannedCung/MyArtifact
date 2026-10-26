import type { ArtifactType } from './types.js';

export interface SandboxRenderOptions {
  artifactId: string;
  title: string;
  type: ArtifactType;
  language?: string;
  content: string;
  initialStorage?: Record<string, string>;
  standalone?: boolean;
  theme?: 'dark' | 'light';
}

export function buildSandboxHtml(options: SandboxRenderOptions): string {
  const {
    artifactId,
    title,
    type,
    language = '',
    content,
    initialStorage = {},
    standalone = false,
    theme = 'dark',
  } = options;

  const escapedTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const serializedContent = JSON.stringify(content);
  const serializedStorage = JSON.stringify(initialStorage);
  const serializedArtifactId = JSON.stringify(artifactId);

  const storageBridgeScript = `
    (function() {
      const ARTIFACT_ID = ${serializedArtifactId};
      const STANDALONE = ${standalone ? 'true' : 'false'};
      const LOCAL_CACHE = Object.assign({}, ${serializedStorage});
      const LS_PREFIX = 'myartifact_storage_' + ARTIFACT_ID + ':';

      if (STANDALONE) {
        try {
          for (const [k, v] of Object.entries(LOCAL_CACHE)) {
            if (localStorage.getItem(LS_PREFIX + k) === null) {
              localStorage.setItem(LS_PREFIX + k, String(v));
            }
          }
        } catch (e) {}
      }

      let reqCounter = 0;
      const pending = new Map();

      window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== 'MYARTIFACT_STORAGE_RES') return;
        const handler = pending.get(data.requestId);
        if (handler) {
          pending.delete(data.requestId);
          if (data.error) handler.reject(new Error(data.error));
          else handler.resolve(data.result);
        }
      });

      function callHostStorage(action, payload) {
        if (STANDALONE || window.parent === window) {
          return Promise.resolve().then(() => {
            if (action === 'get') {
              try {
                const raw = localStorage.getItem(LS_PREFIX + payload.key);
                if (raw !== null) return { key: payload.key, value: raw };
              } catch (e) {}
              if (Object.prototype.hasOwnProperty.call(LOCAL_CACHE, payload.key)) {
                return { key: payload.key, value: String(LOCAL_CACHE[payload.key]) };
              }
              return null;
            }
            if (action === 'set') {
              const val = String(payload.value);
              LOCAL_CACHE[payload.key] = val;
              try { localStorage.setItem(LS_PREFIX + payload.key, val); } catch (e) {}
              return { key: payload.key, value: val };
            }
            if (action === 'delete') {
              const existed = Object.prototype.hasOwnProperty.call(LOCAL_CACHE, payload.key);
              delete LOCAL_CACHE[payload.key];
              try { localStorage.removeItem(LS_PREFIX + payload.key); } catch (e) {}
              return { key: payload.key, deleted: existed };
            }
            if (action === 'list') {
              const prefix = payload.prefix || '';
              const keys = new Set(Object.keys(LOCAL_CACHE));
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && k.startsWith(LS_PREFIX)) {
                    keys.add(k.slice(LS_PREFIX.length));
                  }
                }
              } catch (e) {}
              return {
                keys: Array.from(keys).filter((k) => k.startsWith(prefix)).sort(),
                prefix,
              };
            }
          });
        }

        return new Promise((resolve, reject) => {
          const requestId = 'req_' + (++reqCounter) + '_' + Date.now();
          pending.set(requestId, { resolve, reject });
          window.parent.postMessage({
            type: 'MYARTIFACT_STORAGE_REQ',
            artifactId: ARTIFACT_ID,
            requestId,
            action,
            payload,
          }, '*');
        });
      }

      // Claude Artifacts compatible window.storage API
      window.storage = {
        get: (key, shared = false) => callHostStorage('get', { key: String(key), shared }),
        set: (key, value, shared = false) => callHostStorage('set', { key: String(key), value: String(value), shared }),
        delete: (key, shared = false) => callHostStorage('delete', { key: String(key), shared }),
        list: (prefix = '', shared = false) => callHostStorage('list', { prefix: String(prefix || ''), shared }),
      };
    })();
  `;

  if (type === 'html') {
    // Inject window.storage and Tailwind if not already present
    const hasHtmlTag = /<html[\s>]/i.test(content);
    if (hasHtmlTag) {
      if (/<head[\s>]/i.test(content)) {
        return content.replace(
          /<head([^>]*)>/i,
          `<head$1><script>${storageBridgeScript}</script>`
        );
      }
      return `<script>${storageBridgeScript}</script>\n${content}`;
    }
    return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <script>${storageBridgeScript}</script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="m-0 p-0">
${content}
</body>
</html>`;
  }

  if (type === 'react') {
    return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <script>${storageBridgeScript}</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.3.1",
      "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
      "react-dom": "https://esm.sh/react-dom@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
      "lucide-react": "https://esm.sh/lucide-react@0.460.0?external=react,react-dom",
      "recharts": "https://esm.sh/recharts@2.13.3?external=react,react-dom",
      "d3": "https://esm.sh/d3@7.9.0",
      "three": "https://esm.sh/three@0.170.0",
      "lodash": "https://esm.sh/lodash-es@4.17.21",
      "papaparse": "https://esm.sh/papaparse@5.4.1",
      "mathjs": "https://esm.sh/mathjs@13.2.0",
      "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3"
    }
  }
  </script>
  <script src="https://unpkg.com/@babel/standalone@7.26.9/babel.min.js"></script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    #error-overlay {
      display: none;
      margin: 24px;
      padding: 20px;
      border-radius: 12px;
      background: #1e1b2e;
      border: 1px solid #ef4444;
      color: #fca5a5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre-wrap;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error-overlay"></div>
  <script type="module">
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    window.React = React;

    const rawCode = ${serializedContent};
    const errorEl = document.getElementById('error-overlay');

    function showError(title, err) {
      errorEl.style.display = 'block';
      errorEl.textContent = title + '\\n\\n' + (err && (err.stack || err.message) ? (err.stack || err.message) : String(err));
    }

    window.addEventListener('error', (e) => showError('Runtime Error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => showError('Unhandled Promise Rejection', e.reason));

    try {
      const compiled = Babel.transform(rawCode, {
        filename: 'Artifact.tsx',
        presets: [
          ['react', { runtime: 'automatic' }],
          ['typescript', { isTSX: true, allExtensions: true }]
        ],
      }).code;

      const blob = new Blob([compiled], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const mod = await import(url);
      URL.revokeObjectURL(url);

      const Component = mod.default || Object.values(mod).find((v) => typeof v === 'function');
      if (!Component) {
        throw new Error('No default export or React component function found in artifact.');
      }

      const root = createRoot(document.getElementById('root'));
      root.render(React.createElement(Component));
    } catch (err) {
      showError('Artifact Compilation / Render Error', err);
    }
  </script>
</body>
</html>`;
  }

  if (type === 'svg') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapedTitle}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${theme === 'dark' ? '#0f172a' : '#f8fafc'};
      background-image: radial-gradient(${theme === 'dark' ? '#334155' : '#cbd5e1'} 1px, transparent 1px);
      background-size: 20px 20px;
      overflow: auto;
      padding: 24px;
      box-sizing: border-box;
    }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  if (type === 'mermaid') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapedTitle}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: false, theme: '${theme === 'dark' ? 'dark' : 'default'}' });
    window.addEventListener('DOMContentLoaded', async () => {
      const container = document.getElementById('diagram');
      try {
        const { svg } = await mermaid.render('mermaid-svg', ${serializedContent});
        container.innerHTML = svg;
      } catch (err) {
        container.innerHTML = '<pre style="color:#f87171;padding:16px;">' + String(err) + '</pre>';
      }
    });
  </script>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${theme === 'dark' ? '#0f172a' : '#ffffff'};
      color: ${theme === 'dark' ? '#f8fafc' : '#0f172a'};
      padding: 24px;
      box-sizing: border-box;
      font-family: system-ui, sans-serif;
    }
    #diagram { width: 100%; display: flex; justify-content: center; }
  </style>
</head>
<body>
  <div id="diagram">Rendering diagram...</div>
</body>
</html>`;
  }

  if (type === 'markdown') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapedTitle}</title>
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <script type="module">
    import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15/lib/marked.esm.js';
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

    mermaid.initialize({ startOnLoad: false, theme: '${theme === 'dark' ? 'dark' : 'default'}' });

    window.addEventListener('DOMContentLoaded', async () => {
      const raw = ${serializedContent};
      const html = marked.parse(raw, { gfm: true, breaks: true });
      const contentEl = document.getElementById('md-root');
      contentEl.innerHTML = html;

      // Render any fenced mermaid blocks inside markdown
      const mermaidBlocks = contentEl.querySelectorAll('code.language-mermaid');
      let idx = 0;
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        const graphCode = block.textContent || '';
        try {
          const { svg } = await mermaid.render('md-mermaid-' + (++idx), graphCode);
          const wrapper = document.createElement('div');
          wrapper.className = 'my-6 flex justify-center p-4 rounded-xl bg-slate-900/50 border border-slate-800';
          wrapper.innerHTML = svg;
          pre.replaceWith(wrapper);
        } catch (e) {}
      }
    });
  </script>
</head>
<body class="${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'} min-h-screen p-8">
  <article id="md-root" class="prose ${theme === 'dark' ? 'prose-invert' : ''} max-w-4xl mx-auto"></article>
</body>
</html>`;
  }

  // Fallback: syntax-highlighted code view
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapedTitle}</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <pre id="code-block"></pre>
  <script>
    document.getElementById('code-block').textContent = ${serializedContent};
  </script>
</body>
</html>`;
}
