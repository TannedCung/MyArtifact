import type { ArtifactType } from './types.js';

const SHARED_SANDBOX_IMPORTS: Record<string, string> = {
  d3: 'https://esm.sh/d3@7.9.0',
  three: 'https://esm.sh/three@0.170.0',
  'three/addons/': 'https://esm.sh/three@0.170.0/examples/jsm/',
  'three/examples/jsm/': 'https://esm.sh/three@0.170.0/examples/jsm/',
  lodash: 'https://esm.sh/lodash-es@4.17.21',
  papaparse: 'https://esm.sh/papaparse@5.4.1',
  mathjs: 'https://esm.sh/mathjs@13.2.0',
  'canvas-confetti': 'https://esm.sh/canvas-confetti@1.9.3',
};

const REACT_SANDBOX_IMPORTS: Record<string, string> = {
  react: 'https://esm.sh/react@18.3.1',
  'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
  'react-dom': 'https://esm.sh/react-dom@18.3.1',
  'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
  'lucide-react': 'https://esm.sh/lucide-react@0.460.0?external=react,react-dom',
  recharts: 'https://esm.sh/recharts@2.13.3?external=react,react-dom',
  ...SHARED_SANDBOX_IMPORTS,
  '@react-three/fiber': 'https://esm.sh/@react-three/fiber@8.17.10?external=react,react-dom,three',
  '@react-three/drei':
    'https://esm.sh/@react-three/drei@9.117.3?external=react,react-dom,three,@react-three/fiber',
};

function buildImportMapScript(imports: Record<string, string>): string {
  return `<script type="importmap">\n  ${JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ')}\n  </script>`;
}

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

  const htmlImportMapScript = buildImportMapScript(SHARED_SANDBOX_IMPORTS);
  const reactImportMapScript = buildImportMapScript(REACT_SANDBOX_IMPORTS);

  if (type === 'html') {
    // Inject Three.js/utility importmap (if none provided), window.storage, and Tailwind
    const hasHtmlTag = /<html[\s>]/i.test(content);
    const hasImportMap = /<script[^>]+type=["']importmap["']/i.test(content);
    const importMapTag = hasImportMap ? '' : htmlImportMapScript;
    if (hasHtmlTag) {
      if (/<head[\s>]/i.test(content)) {
        return content.replace(
          /<head([^>]*)>/i,
          `<head$1>${importMapTag}<script>${storageBridgeScript}</script>`
        );
      }
      return `${importMapTag}<script>${storageBridgeScript}</script>\n${content}`;
    }
    return `<!DOCTYPE html>
<html lang="en" class="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  ${importMapTag}
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
  ${reactImportMapScript}
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

  if (type === 'tensorboard') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <script>${storageBridgeScript}</script>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
  <style>
    :root {
      --bg: #F7F4ED;
      --surface: #FCFBF7;
      --sunken: #EFEBE1;
      --border: #E2DDD0;
      --border-strong: #D3CDBD;
      --ink: #1E2420;
      --ink-2: #4A524A;
      --ink-3: #656C62;
      --sage: #55684F;
      --sage-soft: #E4EADF;
      --brass: #C8A96B;
      --brass-soft: #F8F1E3;
      --brass-ink: #735C2B;
      --danger: #B4553F;
      --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
      --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 24px;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .hdr { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .eyebrow { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); margin: 0 0 4px; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; }
    .pill-sage { background: var(--sage-soft); color: var(--sage); }
    .pill-brass { background: var(--brass-soft); color: var(--brass-ink); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
    .kpi-label { font-size: 12px; color: var(--ink-2); }
    .kpi-val { font-family: var(--font-mono); font-size: 20px; font-weight: 600; margin-top: 4px; }
    .kpi-sub { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; }
    .tabs { display: flex; gap: 6px; }
    .tab { height: 30px; padding: 0 12px; border-radius: 6px; border: 0; background: transparent; color: var(--ink-2); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
    .tab.active { background: var(--sage-soft); color: var(--ink); }
    .ctrl { display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--ink-2); }
    .ctrl input[type=range] { width: 96px; accent-color: var(--sage); }
    .ctrl select { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg); font-family: var(--font-mono); font-size: 11.5px; color: var(--ink); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .tag-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--ink); }
    .tag-val { font-family: var(--font-mono); font-size: 16px; font-weight: 600; color: var(--sage); }
    .stats-row { display: flex; gap: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); }
    .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: var(--sunken); padding: 9px 14px; font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); border-bottom: 1px solid var(--border); }
    td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
    tr:last-child td { border-bottom: 0; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .btn-dl { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 6px; background: var(--sage); color: var(--bg); text-decoration: none; font-size: 12px; font-weight: 500; }
    .chip { display: inline-block; font-family: var(--font-mono); font-size: 11px; background: var(--sunken); border-radius: 4px; padding: 2px 6px; margin-right: 4px; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div class="wrap" id="app"></div>
  <script>
    const raw = ${serializedContent};
    let data = {};
    try { data = JSON.parse(raw); } catch (e) { data = { title: 'Invalid TensorBoard Manifest', scalars: {}, checkpoints: [], hparams: {} }; }

    const COLORS = ['#55684F', '#C8A96B', '#7C93A8', '#B8876F', '#8FA28A'];
    let activeTab = 'scalars';
    let smoothing = 0.6;
    let xAxis = 'step';

    function fmtBytes(n) {
      if (!n) return '0 B';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1048576).toFixed(2) + ' MB';
    }

    function fmtNum(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return '–';
      if (Math.abs(v) > 0 && Math.abs(v) < 0.001) return v.toExponential(2);
      return Number(v.toFixed(4)).toString();
    }

    function emaSmooth(values, weight) {
      if (!values.length) return [];
      let last = values[0];
      return values.map((v) => {
        last = last * weight + (1 - weight) * v;
        return last;
      });
    }

    function buildChartSvg(points, color) {
      if (!points || points.length === 0) return '<div style="height:150px;display:flex;align-items:center;justify-content:center;color:#9A9F94">No points</div>';
      const w = 360, h = 150, padL = 38, padR = 10, padT = 10, padB = 22;
      const cw = w - padL - padR, ch = h - padT - padB;
      const t0 = points[0].wallTime || 0;
      const xs = points.map((p, idx) => xAxis === 'epoch' ? (p.epoch ?? idx) : xAxis === 'relative' ? Math.max(0, (p.wallTime || t0) - t0) : p.step);
      const ys = points.map((p) => p.value);
      const smoothYs = emaSmooth(ys, smoothing);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const allY = [...ys, ...smoothYs];
      let minY = Math.min(...allY), maxY = Math.max(...allY);
      if (minY === maxY) { minY -= 1; maxY += 1; }

      const sx = (x) => padL + (maxX === minX ? cw / 2 : ((x - minX) / (maxX - minX)) * cw);
      const sy = (y) => padT + ch - ((y - minY) / (maxY - minY)) * ch;

      const rawPath = points.map((_, i) => (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ',' + sy(ys[i]).toFixed(1)).join(' ');
      const smoothPath = points.map((_, i) => (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ',' + sy(smoothYs[i]).toFixed(1)).join(' ');
      const areaPath = smoothPath + ' L' + sx(xs[xs.length - 1]).toFixed(1) + ',' + (padT + ch) + ' L' + sx(xs[0]).toFixed(1) + ',' + (padT + ch) + ' Z';
      const lastX = sx(xs[xs.length - 1]).toFixed(1);
      const lastY = sy(smoothYs[smoothYs.length - 1]).toFixed(1);

      return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:150px;display:block">' +
        '<line x1="' + padL + '" y1="' + padT + '" x2="' + (w - padR) + '" y2="' + padT + '" stroke="#E2DDD0" stroke-dasharray="2 2"/>' +
        '<line x1="' + padL + '" y1="' + (padT + ch / 2) + '" x2="' + (w - padR) + '" y2="' + (padT + ch / 2) + '" stroke="#E2DDD0" stroke-dasharray="2 2"/>' +
        '<line x1="' + padL + '" y1="' + (padT + ch) + '" x2="' + (w - padR) + '" y2="' + (padT + ch) + '" stroke="#D3CDBD"/>' +
        '<text x="' + (padL - 5) + '" y="' + (padT + 8) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#656C62">' + fmtNum(maxY) + '</text>' +
        '<text x="' + (padL - 5) + '" y="' + (padT + ch) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#656C62">' + fmtNum(minY) + '</text>' +
        '<text x="' + padL + '" y="' + (h - 4) + '" text-anchor="start" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#656C62">' + fmtNum(minX) + '</text>' +
        '<text x="' + (w - padR) + '" y="' + (h - 4) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#656C62">' + fmtNum(maxX) + '</text>' +
        '<path d="' + areaPath + '" fill="' + color + '" fill-opacity="0.10"/>' +
        (smoothing > 0 ? '<path d="' + rawPath + '" fill="none" stroke="' + color + '" stroke-opacity="0.28" stroke-width="1.25"/>' : '') +
        '<path d="' + smoothPath + '" fill="none" stroke="' + color + '" stroke-width="2"/>' +
        '<circle cx="' + lastX + '" cy="' + lastY + '" r="3.5" fill="' + color + '"/>' +
      '</svg>';
    }

    function render() {
      const scalars = data.scalars || {};
      const tags = Object.keys(scalars);
      const ckpts = data.checkpoints || [];
      const hparams = data.hparams || {};
      const bestCkpt = ckpts.find((c) => c.isBest) || ckpts[0];
      let maxStep = 0;
      tags.forEach((t) => scalars[t].forEach((p) => { if (p.step > maxStep) maxStep = p.step; }));

      const root = document.getElementById('app');
      root.innerHTML = \`
        <header class="hdr">
          <div>
            <p class="eyebrow">TensorBoard Run · \${data.framework || 'pytorch'} · \${data.experiment || 'default'}</p>
            <h1>\${data.title || data.runSlug || 'Training Run'}</h1>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="pill pill-sage">● \${data.status || 'running'}</span>
            \${bestCkpt ? \`<span class="pill pill-brass">★ Best: \${bestCkpt.name} (step \${bestCkpt.step})</span>\` : ''}
          </div>
        </header>

        <section class="kpis">
          <div class="kpi">
            <div class="kpi-label">Model architecture</div>
            <div class="kpi-val" style="font-size:16px">\${data.modelName || data.runSlug || 'model'}</div>
            <div class="kpi-sub">logdir: ~/.myartifact/runs/\${data.runSlug || ''}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Training steps logged</div>
            <div class="kpi-val">\${maxStep.toLocaleString()}</div>
            <div class="kpi-sub">\${tags.length} scalar series in .tfevents</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Saved model checkpoints</div>
            <div class="kpi-val">\${ckpts.length}</div>
            <div class="kpi-sub">\${bestCkpt ? 'Latest: ' + bestCkpt.name : 'No checkpoints saved yet'}</div>
          </div>
        </section>

        <div class="bar">
          <div class="tabs">
            <button class="tab \${activeTab === 'scalars' ? 'active' : ''}" data-tab="scalars">Scalars (\${tags.length})</button>
            <button class="tab \${activeTab === 'checkpoints' ? 'active' : ''}" data-tab="checkpoints">Saved Models (\${ckpts.length})</button>
            <button class="tab \${activeTab === 'hparams' ? 'active' : ''}" data-tab="hparams">HParams (\${Object.keys(hparams).length})</button>
          </div>
          \${activeTab === 'scalars' ? \`
            <div class="ctrl">
              <label style="display:flex;align-items:center;gap:6px">
                Smoothing <strong class="mono">\${smoothing.toFixed(2)}</strong>
                <input id="smoothSlider" type="range" min="0" max="0.95" step="0.05" value="\${smoothing}" />
              </label>
              <label style="display:flex;align-items:center;gap:6px">
                Horizontal
                <select id="xAxisSel">
                  <option value="step" \${xAxis === 'step' ? 'selected' : ''}>Step</option>
                  <option value="epoch" \${xAxis === 'epoch' ? 'selected' : ''}>Epoch</option>
                  <option value="relative" \${xAxis === 'relative' ? 'selected' : ''}>Relative time (s)</option>
                </select>
              </label>
            </div>
          \` : ''}
        </div>

        \${activeTab === 'scalars' ? \`
          <section class="grid">
            \${tags.map((tag, i) => {
              const pts = scalars[tag] || [];
              const ys = pts.map((p) => p.value);
              const first = ys[0] ?? 0, last = ys[ys.length - 1] ?? 0;
              const min = ys.length ? Math.min(...ys) : 0;
              const max = ys.length ? Math.max(...ys) : 0;
              const color = COLORS[i % COLORS.length];
              return \`
                <div class="card">
                  <div class="card-top">
                    <span class="tag-name">\${tag}</span>
                    <span class="tag-val" style="color:\${color}">\${fmtNum(last)}</span>
                  </div>
                  \${buildChartSvg(pts, color)}
                  <div class="stats-row">
                    <span>min: \${fmtNum(min)}</span>
                    <span>max: \${fmtNum(max)}</span>
                    <span>start: \${fmtNum(first)}</span>
                    <span>steps: \${pts.length}</span>
                  </div>
                </div>
              \`;
            }).join('')}
          </section>
        \` : ''}

        \${activeTab === 'checkpoints' ? \`
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model Checkpoint</th>
                  <th>Step / Epoch</th>
                  <th>Validation Metrics</th>
                  <th>Format & Size</th>
                  <th>SHA-256</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                \${ckpts.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:#656C62">No model checkpoints saved yet. Use <code>myartifact tb save-model</code> or MCP <code>tb_save_checkpoint</code>.</td></tr>' : ckpts.map((c) => \`
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px;font-weight:600">
                        <span class="mono">\${c.name}</span>
                        \${c.isBest ? '<span class="pill pill-brass" style="padding:1px 7px;font-size:10px">BEST</span>' : ''}
                      </div>
                      <div class="mono" style="font-size:11px;color:#656C62;margin-top:2px">\${c.filePath}</div>
                    </td>
                    <td class="mono">step \${c.step}\${c.epoch != null ? ' · ep ' + c.epoch : ''}</td>
                    <td>
                      \${Object.entries(c.metrics || {}).map(([k, v]) => \`<span class="chip">\${k}: \${fmtNum(v)}</span>\`).join('') || '<span style="color:#9A9F94">–</span>'}
                    </td>
                    <td class="mono">.\${c.format} · \${fmtBytes(c.byteSize)}</td>
                    <td class="mono" style="color:#656C62">\${(c.sha256 || '').slice(0, 10)}…</td>
                    <td style="text-align:right">
                      <a class="btn-dl" href="/api/tensorboard/runs/\${encodeURIComponent(data.runSlug)}/checkpoints/\${encodeURIComponent(c.id)}/download" download="\${c.name}">Download</a>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \` : ''}

        \${activeTab === 'hparams' ? \`
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Hyperparameter / Config</th><th>Value</th></tr>
              </thead>
              <tbody>
                \${Object.entries(hparams).map(([k, v]) => \`
                  <tr>
                    <td class="mono" style="font-weight:500">\${k}</td>
                    <td class="mono">\${String(v)}</td>
                  </tr>
                \`).join('')}
                <tr>
                  <td class="mono" style="font-weight:500">tensorboard_logdir</td>
                  <td class="mono">\${data.logDir || ''}</td>
                </tr>
                <tr>
                  <td class="mono" style="font-weight:500">tfevents_file</td>
                  <td class="mono">\${data.eventFilePath || ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
        \` : ''}
      \`;

      root.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.onclick = () => { activeTab = btn.getAttribute('data-tab'); render(); };
      });
      const slider = document.getElementById('smoothSlider');
      if (slider) {
        slider.oninput = (e) => { smoothing = parseFloat(e.target.value); render(); };
      }
      const xSel = document.getElementById('xAxisSel');
      if (xSel) {
        xSel.onchange = (e) => { xAxis = e.target.value; render(); };
      }
    }

    render();
  </script>
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
