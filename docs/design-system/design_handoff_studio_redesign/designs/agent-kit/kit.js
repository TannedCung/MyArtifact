// Shared helpers for the agent-kit: theme block generation, theme swapping, and a
// lightweight preview sandbox mirroring src/core/sandbox-template.ts.
const S = 'scr' + 'ipt';

export async function loadKit(base = 'agent-kit/') {
  const kit = await (await fetch(base + 'themes.json')).json();
  const files = {};
  await Promise.all(Object.entries(kit.templates).map(async ([id, t]) => {
    files[id] = await (await fetch(base + t.file)).text();
  }));
  return { kit, files };
}

export function cssVars(t) {
  return `:root{--ma-bg:${t.bg};--ma-surface:${t.surface};--ma-sunken:${t.sunken};--ma-border:${t.border};--ma-ink:${t.ink};--ma-muted:${t.muted};--ma-accent:${t.accent};--ma-accent-ink:${t.accentInk};--ma-accent-soft:${t.accentSoft};--ma-highlight:${t.highlight};--ma-highlight-soft:${t.highlightSoft};--ma-danger:${t.danger};--ma-font-sans:${t.fontSans};--ma-font-display:${t.fontDisplay};--ma-font-mono:${t.fontMono}}`;
}

export function mermaidInit(t) {
  const fam = t.fontSans.replace(/'/g, '');
  return `%%{init: {"theme":"base","themeVariables":{"fontFamily":"${fam}","fontSize":"14px","background":"${t.bg}","primaryColor":"${t.accentSoft}","primaryTextColor":"${t.ink}","primaryBorderColor":"${t.accent}","lineColor":"${t.muted}","secondaryColor":"${t.highlightSoft}","secondaryBorderColor":"${t.highlight}","tertiaryColor":"${t.sunken}","clusterBkg":"${t.surface}","clusterBorder":"${t.border}","edgeLabelBackground":"${t.bg}","nodeTextColor":"${t.ink}"}}}%%`;
}

export function applyTheme(type, src, id, t, fontsUrl) {
  if (type === 'mermaid') {
    const lines = src.split('\n');
    lines[0] = mermaidInit(t);
    return lines.join('\n').replace(/%% theme: [\w-]+/, `%% theme: ${id}`);
  }
  const imp = `@import url('${fontsUrl}');`;
  let out = src.replace(/(\/\* theme:start \*\/)[\s\S]*?(\/\* theme:end \*\/)/, (_, a, b) => {
    if (type === 'react') {
      return `${a}\nconst THEME = { name: '${id}', grid: '${t.border}', axis: '${t.muted}', surface: '${t.surface}', chart: [${t.chart.map((c) => `'${c}'`).join(', ')}] };\nconst THEME_CSS = \`${imp}\n${cssVars(t)}\`;\n${b}`;
    }
    const ind = type === 'html' ? '    ' : '';
    return `${a}\n${ind}${imp}\n${ind}${cssVars(t)}\n${ind}${b}`;
  });
  return out.replace(/theme:[a-z-]+(?=[,\s])/g, (m) => (m === 'theme:start' || m === 'theme:end' ? m : `theme:${id}`));
}

const STORAGE_SHIM = `<${S}>(function(){var P='ma_preview:';window.storage={get:function(k){var v=localStorage.getItem(P+k);return Promise.resolve(v==null?null:{key:k,value:v})},set:function(k,v){localStorage.setItem(P+k,String(v));return Promise.resolve({key:k,value:String(v)})},delete:function(k){localStorage.removeItem(P+k);return Promise.resolve({key:k,deleted:true})},list:function(p){p=p||'';var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(P+p)===0)ks.push(k.slice(P.length))}return Promise.resolve({keys:ks,prefix:p})}}})();</${S}>`;

export function buildPreview(type, content, t) {
  const json = JSON.stringify(content).replace(/<\//g, '<\\/');
  if (type === 'html') {
    return content.replace(/<head([^>]*)>/i, `<head$1>${STORAGE_SHIM}<${S} src="https://cdn.tailwindcss.com"></${S}>`);
  }
  if (type === 'react') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>${STORAGE_SHIM}
<${S} src="https://cdn.tailwindcss.com"></${S}>
<${S} type="importmap">{"imports":{"react":"https://esm.sh/react@18.3.1","react/jsx-runtime":"https://esm.sh/react@18.3.1/jsx-runtime","react-dom":"https://esm.sh/react-dom@18.3.1","react-dom/client":"https://esm.sh/react-dom@18.3.1/client","lucide-react":"https://esm.sh/lucide-react@0.460.0?external=react,react-dom","recharts":"https://esm.sh/recharts@2.13.3?external=react,react-dom"}}</${S}>
<${S} src="https://unpkg.com/@babel/standalone@7.26.9/babel.min.js"></${S}>
<style>body{margin:0;background:${t.bg}}#err{display:none;margin:24px;padding:16px;border-radius:10px;border:1px solid ${t.danger};color:${t.danger};font:12px ui-monospace,monospace;white-space:pre-wrap}</style></head>
<body><div id="root"></div><div id="err"></div>
<${S} type="module">
import * as React from 'react'; import { createRoot } from 'react-dom/client';
const err = document.getElementById('err');
try {
  const code = Babel.transform(${json}, { filename: 'Artifact.tsx', presets: [['react', { runtime: 'automatic' }], ['typescript', { isTSX: true, allExtensions: true }]] }).code;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const mod = await import(url);
  createRoot(document.getElementById('root')).render(React.createElement(mod.default));
} catch (e) { err.style.display = 'block'; err.textContent = String(e && e.stack || e); }
</${S}></body></html>`;
  }
  if (type === 'mermaid') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${t.bg};padding:24px;box-sizing:border-box}#d{width:100%;display:flex;justify-content:center}#d svg{max-width:100%;height:auto}</style>
<${S} type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false });
const { svg } = await mermaid.render('m', ${json}); document.getElementById('d').innerHTML = svg;
</${S}><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap"></head><body><div id="d"></div></body></html>`;
  }
  if (type === 'markdown') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<${S} src="https://cdn.tailwindcss.com?plugins=typography"></${S}>
<${S} type="module">
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15/lib/marked.esm.js';
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { primaryColor: '${t.accentSoft}', primaryBorderColor: '${t.accent}', primaryTextColor: '${t.ink}', lineColor: '${t.muted}', fontFamily: 'IBM Plex Sans, sans-serif' } });
const el = document.getElementById('md-root'); el.innerHTML = marked.parse(${json}, { gfm: true, breaks: true });
let i = 0; for (const b of el.querySelectorAll('code.language-mermaid')) { try { const { svg } = await mermaid.render('mm' + (++i), b.textContent); const w = document.createElement('div'); w.className = 'my-6 flex justify-center p-4 rounded-xl border'; w.innerHTML = svg; b.parentElement.replaceWith(w); } catch (e) {} }
</${S}></head><body class="min-h-screen p-8"><article id="md-root" class="prose max-w-4xl mx-auto"></article></body></html>`;
  }
  return `<pre>${content.replace(/</g, '&lt;')}</pre>`;
}
