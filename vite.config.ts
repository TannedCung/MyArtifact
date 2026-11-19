import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

function seoSiteOriginPlugin(): Plugin {
  return {
    name: 'myartifact-seo-origin',
    transformIndexHtml(html) {
      const siteOrigin = (
        process.env.MYARTIFACT_PUBLIC_URL ||
        process.env.VITE_SITE_URL ||
        'https://myartifact.app'
      ).replace(/\/+$/, '');
      return html.replaceAll('__SITE_ORIGIN__', siteOrigin);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoSiteOriginPlugin()],
  root: path.resolve(__dirname, 'src/web'),
  build: {
    outDir: path.resolve(__dirname, 'dist/public'),
    emptyOutDir: true,
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
