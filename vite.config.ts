import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { renderSeoLandingHtml } from './src/web/seo-landing-render.js';

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
      const isCloudMode = Boolean(
        process.env.VERCEL || process.env.MYARTIFACT_MODE === 'cloud'
      );
      const preRenderedLanding = renderSeoLandingHtml({
        theme: 'day',
        isCloudMode,
        googleEnabled: true,
        authenticated: false,
        userEmail: null,
      });

      return html
        .replaceAll('__SITE_ORIGIN__', siteOrigin)
        .replace('<!-- __GSC_VERIFICATION_META__ -->', gscMetaTag)
        .replace('<!-- __PRE_RENDERED_LANDING__ -->', () => preRenderedLanding);
    },
  };
}

function optimizeLandingHtmlPlugin(): Plugin {
  return {
    name: 'myartifact-optimize-landing-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = bundle['index.html'];
      if (!htmlAsset || htmlAsset.type !== 'asset') return;

      let html =
        typeof htmlAsset.source === 'string'
          ? htmlAsset.source
          : Buffer.from(htmlAsset.source).toString('utf8');

      const inlinedCssBlocks: string[] = [];

      html = html.replace(/<link\b[^>]*>\s*/gi, (tag) => {
        if (/\brel=["']stylesheet["']/i.test(tag)) {
          const hrefMatch = tag.match(/\bhref=["'](\/assets\/[^"']+\.css)["']/i);
          if (hrefMatch) {
            const bundleKey = hrefMatch[1].replace(/^\//, '');
            const cssAsset = bundle[bundleKey];
            if (cssAsset && cssAsset.type === 'asset') {
              const cssText =
                typeof cssAsset.source === 'string'
                  ? cssAsset.source
                  : Buffer.from(cssAsset.source).toString('utf8');
              inlinedCssBlocks.push(cssText);
              return '';
            }
          }
        }

        if (/\brel=["']modulepreload["']/i.test(tag)) {
          const hrefMatch = tag.match(/\bhref=["'](\/assets\/[^"']+\.js)["']/i);
          if (
            hrefMatch &&
            /\/assets\/(?:vendor-|studio-|App-)/.test(hrefMatch[1])
          ) {
            return '';
          }
        }

        return tag;
      });

      if (inlinedCssBlocks.length > 0) {
        const styleTag = `<style>${inlinedCssBlocks.join('\n')}</style>\n  </head>`;
        html = html.replace('</head>', () => styleTag);
      }

      htmlAsset.source = html;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoSiteOriginPlugin(), optimizeLandingHtmlPlugin()],
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
