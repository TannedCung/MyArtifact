import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function seoSiteOriginPlugin(): Plugin {
  return {
    name: 'myartifact-seo-origin',
    transformIndexHtml(html) {
      const siteOrigin = (
        process.env.MYARTIFACT_PUBLIC_URL ||
        process.env.VITE_SITE_URL ||
        'https://myartifact.app'
      ).replace(/\/+$/, '');
      const gscToken = (
        process.env.GOOGLE_SITE_VERIFICATION ||
        process.env.VITE_GOOGLE_SITE_VERIFICATION ||
        ''
      ).trim();
      const gscMetaTag = gscToken
        ? `<meta name="google-site-verification" content="${escapeHtmlAttr(gscToken)}" />`
        : '';

      return html
        .replaceAll('__SITE_ORIGIN__', siteOrigin)
        .replace('<!-- __GSC_VERIFICATION_META__ -->', gscMetaTag);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoSiteOriginPlugin()],
  root: path.resolve(__dirname, 'src/web'),
  define: {
    __DEFAULT_CLOUD_MODE__: JSON.stringify(
      Boolean(process.env.VERCEL || process.env.MYARTIFACT_MODE === 'cloud')
    ),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (id.includes('/node_modules/diff/')) return 'vendor-diff';
          if (id.includes('/node_modules/mermaid/')) return 'vendor-mermaid';
          if (id.includes('/node_modules/marked/')) return 'vendor-marked';
          if (id.includes('/src/web/templates.ts')) return 'studio-templates';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4173',
      '/ws': {
        target: 'ws://127.0.0.1:4173',
        ws: true,
      },
    },
  },
});
