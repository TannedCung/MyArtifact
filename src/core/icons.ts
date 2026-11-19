import type { ArtifactType } from './types.js';
import { MYARTIFACT_LOGO_SVG } from './brand-logo.js';

export { MYARTIFACT_LOGO_SVG };

/**
 * Curated library of bespoke 32x32 SVG logos for artifact presets and specific artifacts.
 */
export const ARTIFACT_ICON_PRESETS: Record<string, string> = {
  // 1. LaTeX Paper / Academic Preprint (Sigma + Integral on Ledger Parchment)
  'latex-paper': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#F4EAD5"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#C8A96B" stroke-opacity="0.7"/>
  <path d="M8.5 9.5H19.5V12H11.8L16.2 16L11.8 20H19.5V22.5H8.5V20.3L13.3 16L8.5 11.7V9.5Z" fill="#735C2B"/>
  <path d="M23.8 8.5C22.4 8.5 21.8 9.6 21.8 11.2V20.8C21.8 22.4 21.2 23.5 19.8 23.5" stroke="#A2452F" stroke-width="2" stroke-linecap="round"/>
  <circle cx="24.2" cy="12.5" r="1.4" fill="#55684F"/>
</svg>`,

  // 2. Multi-Approach Reasoning Tracker (4 Parallel Tracks Converging to Star)
  'multi-approach': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#1D261F"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#55684F" stroke-opacity="0.6"/>
  <path d="M6.5 8.5H13.5L19.5 16H25.5" stroke="#8FA28A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.5 13.5H12L19.5 16" stroke="#C8A96B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.5 18.5H12L19.5 16" stroke="#7C93A8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.5 23.5H13.5L19.5 16" stroke="#D98068" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="6.5" cy="8.5" r="2" fill="#8FA28A"/>
  <circle cx="6.5" cy="13.5" r="2" fill="#C8A96B"/>
  <circle cx="6.5" cy="18.5" r="2" fill="#7C93A8"/>
  <circle cx="6.5" cy="23.5" r="2" fill="#D98068"/>
  <circle cx="24" cy="16" r="3.4" fill="#C8A96B" stroke="#F7F4ED" stroke-width="1.4"/>
</svg>`,

  // 3. DeepSeek-R1 GRPO RL Training Run (Reward Pulse + Policy Loop)
  'grpo-rl': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#17231C"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#4D7A62" stroke-opacity="0.6"/>
  <path d="M5.5 22.5L10.2 19.5L13.8 21L18.2 12.5L21.8 14.5L26.5 8.5" stroke="#6FCF97" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5.5 25H26.5" stroke="#395144" stroke-width="1.4" stroke-linecap="round"/>
  <circle cx="18.2" cy="12.5" r="2.1" fill="#C8A96B"/>
  <circle cx="26.5" cy="8.5" r="2.6" fill="#6FCF97" stroke="#17231C" stroke-width="1"/>
  <path d="M7.5 9.5C9.5 7.5 12.8 7.5 14.8 9.5" stroke="#C8A96B" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="11.2" cy="10.2" r="1.4" fill="#C8A96B"/>
</svg>`,

  // 4. Milestone & Sprint Roadmap Tracker (Burn-up Staircase + Milestone Flag)
  'roadmap-tracker': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#E4EADF"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#55684F" stroke-opacity="0.45"/>
  <rect x="6" y="19" width="4.5" height="6.5" rx="1.2" fill="#8FA28A"/>
  <rect x="12.5" y="15" width="4.5" height="10.5" rx="1.2" fill="#55684F"/>
  <rect x="19" y="10.5" width="4.5" height="15" rx="1.2" fill="#2F402B"/>
  <path d="M21.2 6.5V11.5" stroke="#B4553F" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M21.2 6.5L26.5 8.3L21.2 10.2V6.5Z" fill="#C8A96B" stroke="#735C2B" stroke-width="0.8"/>
</svg>`,

  // 5. Qwen2.5-Coder Evaluation Report (Code Brackets + Benchmark Gauge)
  'coder-eval': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#1E2832"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#7C93A8" stroke-opacity="0.55"/>
  <path d="M11 10L6.2 16L11 22" stroke="#93A9BD" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 10L25.8 16L21 22" stroke="#93A9BD" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="13.2" y="16.5" width="2.2" height="5.5" rx="1" fill="#C8A96B"/>
  <rect x="16.6" y="12.5" width="2.2" height="9.5" rx="1" fill="#8FA28A"/>
  <circle cx="17.7" cy="9.8" r="1.4" fill="#C8A96B"/>
</svg>`,

  // 6. Local-First Artifact Engine Blog (Editorial Nib + Local SQLite Cylinder)
  'engine-blog': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#FBF8F1"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#C8A96B" stroke-opacity="0.8"/>
  <path d="M22.5 7.5L24.5 9.5L14.5 22.5L8.5 24.5L10.5 18.5L22.5 7.5Z" fill="#735C2B" stroke="#2A2110" stroke-width="1.4" stroke-linejoin="round"/>
  <circle cx="14.5" cy="17.5" r="1.5" fill="#FBF8F1"/>
  <path d="M8.5 24.5L13 20" stroke="#FBF8F1" stroke-width="1.3" stroke-linecap="round"/>
  <circle cx="9.5" cy="9.5" r="3" fill="#55684F"/>
</svg>`,

  // 7. Llama-3-8B LoRA Finetune (Loss Decay Curve + Adapter Diamond)
  'llama-lora': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#231F1D"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#C8A96B" stroke-opacity="0.5"/>
  <path d="M6.5 8.5C8.5 18.5 14 22.5 25.5 23.5" stroke="#D98068" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M6.5 13C10 20 15.5 23 25.5 23.5" stroke="#8FA28A" stroke-width="1.8" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>
  <path d="M21 7.5L25.5 12L21 16.5L16.5 12L21 7.5Z" fill="#C8A96B" stroke="#F7F4ED" stroke-width="1.2"/>
</svg>`,

  // 8. Cross-Agent Evaluation Dashboard (Tri-Agent Prism Arena)
  'agent-eval': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#F7F4ED"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#D5CFC0"/>
  <circle cx="16" cy="11.5" r="5.2" fill="#55684F" fill-opacity="0.88"/>
  <circle cx="11.8" cy="19" r="5.2" fill="#C8A96B" fill-opacity="0.88"/>
  <circle cx="20.2" cy="19" r="5.2" fill="#7C93A8" fill-opacity="0.88"/>
  <circle cx="16" cy="16.5" r="2.2" fill="#FCFBF7"/>
</svg>`,

  // 9. System Architecture Flow (Directed Graph Nodes + Sync Ring)
  'arch-flow': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#E9EFE5"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#8FA28A"/>
  <path d="M10 10L22 10L16 22L10 10Z" stroke="#435340" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="10" cy="10" r="3.2" fill="#435340"/>
  <circle cx="22" cy="10" r="3.2" fill="#55684F"/>
  <circle cx="16" cy="22" r="3.5" fill="#C8A96B" stroke="#435340" stroke-width="1.4"/>
</svg>`,

  // 10. Release Readiness Report (Verified Shield Seal)
  'release-shield': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#F4EAD5"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#C8A96B"/>
  <path d="M16 6.5L24 9.8V16.2C24 20.8 20.5 24.4 16 26C11.5 24.4 8 20.8 8 16.2V9.8L16 6.5Z" fill="#55684F" stroke="#2A362B" stroke-width="1.4"/>
  <path d="M12.5 16.2L15 18.7L20 13.5" stroke="#F7F4ED" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  // Generic template presets
  dashboard: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#E4EADF"/>
  <rect x="6" y="6" width="9" height="9" rx="2" fill="#55684F"/>
  <rect x="17" y="6" width="9" height="5.5" rx="1.8" fill="#C8A96B"/>
  <rect x="17" y="13.5" width="9" height="12.5" rx="2" fill="#2F402B"/>
  <rect x="6" y="17" width="9" height="9" rx="2" fill="#8FA28A"/>
</svg>`,

  report: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#F4EAD5"/>
  <rect x="7" y="5.5" width="18" height="21" rx="2.5" fill="#FFFFFF" stroke="#735C2B" stroke-width="1.6"/>
  <path d="M11 11H21M11 15.5H21M11 20H16.5" stroke="#735C2B" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="20" cy="20" r="2" fill="#C8A96B"/>
</svg>`,

  diagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#E9EFE5"/>
  <rect x="6" y="7" width="7" height="6" rx="1.5" fill="#435340"/>
  <rect x="19" y="7" width="7" height="6" rx="1.5" fill="#55684F"/>
  <rect x="12.5" y="19" width="7" height="6" rx="1.5" fill="#C8A96B"/>
  <path d="M9.5 13V16H16V19M22.5 13V16H16" stroke="#435340" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  tool: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#1D231E"/>
  <rect x="6.5" y="6.5" width="19" height="19" rx="3" stroke="#8FA28A" stroke-width="1.6"/>
  <path d="M10.5 12.5L13.5 15.5L10.5 18.5M15.5 19H20.5" stroke="#C8A96B" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  training: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#17231C"/>
  <path d="M6 21L11.5 15L16 18L21.5 10.5L26 13" stroke="#8FA28A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="21.5" cy="10.5" r="2.4" fill="#C8A96B"/>
</svg>`,

  // 3D Scene / Three.js Viewport (Isometric Moss-and-Brass Prism + X/Y/Z Coordinate Axes)
  'scene-3d': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#17231C"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#55684F" stroke-opacity="0.65"/>
  <path d="M16 6.5L24.5 11.2V20.8L16 25.5L7.5 20.8V11.2L16 6.5Z" fill="#263429" stroke="#8FA28A" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M7.5 11.2L16 15.9L24.5 11.2" stroke="#C8A96B" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M16 15.9V25.5" stroke="#F7F4ED" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M16 15.9V8.5M16 15.9L22.2 19.4M16 15.9L9.8 19.4" stroke="#8FA28A" stroke-width="1.2" stroke-linecap="round" opacity="0.75"/>
  <circle cx="16" cy="15.9" r="2.1" fill="#C8A96B" stroke="#17231C" stroke-width="0.9"/>
</svg>`,
};

/**
 * Direct slug-to-preset mapping for known starter and demo artifacts.
 */
const SLUG_ICON_MAP: Record<string, string> = {
  'latex-reasoning-scaling-paper': 'latex-paper',
  'multi-approach-reasoning-tracker': 'multi-approach',
  'deepseek-r1-grpo-reasoning': 'grpo-rl',
  'myartifact-roadmap-tracker': 'roadmap-tracker',
  'qwen-coder-eval-report': 'coder-eval',
  'local-first-artifact-engine-blog': 'engine-blog',
  'training-run-llama3-finetune': 'llama-lora',
  'qwen-coder-lora-run': 'llama-lora',
  'agent-eval-dashboard': 'agent-eval',
  'agent-telemetry-dashboard': 'agent-eval',
  'system-architecture-flow': 'arch-flow',
  'multi-agent-architecture': 'arch-flow',
  'release-readiness-report': 'release-shield',
  'llm-cost-latency-simulator': 'tool',
  'threejs-kinematic-workbench': 'scene-3d',
};

const DANGEROUS_SVG_URL_RE =
  /^(?:javascript|vbscript|data|https?|file|blob):|^[\\/]{2}|^[a-z][a-z0-9+.-]*:/i;

const PRESENTATION_URL_ATTRS = new Set([
  'fill',
  'stroke',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'cursor',
]);

function decodeEntitiesForValidation(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function decodeCssHexEscapes(raw: string): string {
  return raw.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });
}

function isDangerousUrlValue(rawValue: string): boolean {
  const decoded = decodeCssHexEscapes(decodeEntitiesForValidation(rawValue)).replace(
    /[\s\x00-\x1f\x7f]/g,
    ''
  );
  if (!decoded) return false;
  if (decoded.startsWith('#')) return false;
  return DANGEROUS_SVG_URL_RE.test(decoded);
}

function sanitizeCssText(cssText: string, decodeHtmlEntities: boolean): string {
  let out = decodeHtmlEntities ? decodeEntitiesForValidation(cssText) : cssText;
  out = decodeCssHexEscapes(out).replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/@import[^;]*(?:;|$)/gi, '');
  out = out.replace(/expression\s*\([^)]*\)/gi, '');
  out = out.replace(/expression\s*\(/gi, '');
  out = out.replace(/(?:-moz-binding|behavior)\s*:[^;]*(?:;|$)/gi, '');
  out = out.replace(/url\s*\(([^)]*)\)/gi, (full, inner: string) => {
    const trimmed = inner.trim().replace(/^['"]|['"]$/g, '');
    if (isDangerousUrlValue(trimmed)) {
      return 'none';
    }
    return full;
  });
  out = out.replace(
    /url\s*\(\s*['"]?(?:javascript:|vbscript:|data:|https?:|\/\/)/gi,
    'url('
  );
  return out;
}

function sanitizeSvgTagAttributes(rawAttrs: string): { attrs: string; selfClosing: boolean } {
  let working = rawAttrs.trim();
  let selfClosing = false;
  if (working.endsWith('/')) {
    selfClosing = true;
    working = working.slice(0, -1).trimEnd();
  }
  while (working.startsWith('/')) {
    working = working.slice(1).trimStart();
  }
  if (!working) {
    return { attrs: '', selfClosing };
  }

  const kept: string[] = [];
  const attrRe =
    /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(working)) !== null) {
    const attrName = match[1];
    const lowerName = attrName.toLowerCase();
    const hasEquals = match[0].includes('=');
    const dqVal = match[2];
    const sqVal = match[3];
    const uqVal = match[4];
    const rawVal = dqVal ?? sqVal ?? uqVal ?? '';

    if (/^on[a-z]+$/i.test(lowerName)) {
      continue;
    }

    if (
      lowerName === 'href' ||
      lowerName === 'xlink:href' ||
      lowerName === 'src' ||
      lowerName === 'action' ||
      lowerName === 'formaction' ||
      lowerName === 'poster'
    ) {
      if (isDangerousUrlValue(rawVal)) {
        continue;
      }
    }

    if (lowerName === 'style' && hasEquals) {
      const cleanedStyle = sanitizeCssText(rawVal, true)
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      kept.push(`${attrName}="${cleanedStyle}"`);
      continue;
    }

    if (hasEquals && PRESENTATION_URL_ATTRS.has(lowerName)) {
      const cleanedPres = sanitizeCssText(rawVal, true).replace(/"/g, '&quot;');
      kept.push(`${attrName}="${cleanedPres}"`);
      continue;
    }

    if (!hasEquals) {
      kept.push(attrName);
    } else if (dqVal !== undefined) {
      kept.push(`${attrName}="${dqVal}"`);
    } else if (sqVal !== undefined) {
      kept.push(`${attrName}='${sqVal}'`);
    } else {
      kept.push(`${attrName}="${uqVal}"`);
    }
  }

  return {
    attrs: kept.length ? ' ' + kept.join(' ') : '',
    selfClosing,
  };
}

/**
 * Sanitize untrusted custom or extracted SVG markup to block script execution,
 * event handlers, external/scriptable URLs, and unsafe CSS constructs.
 */
export function sanitizeSvgMarkup(rawSvg: string): string | null {
  if (!rawSvg || typeof rawSvg !== 'string') return null;
  let cleaned = rawSvg.replace(/\0/g, '').trim();
  if (!cleaned) return null;

  for (let pass = 0; pass < 8; pass++) {
    const prev = cleaned;
    cleaned = cleaned
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '')
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
      .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
      .replace(/<object\b[\s\S]*?<\/object\s*>/gi, '')
      .replace(
        /<\/?(?:script|foreignObject|iframe|object|embed|meta|link|base|animate|animateTransform|animateMotion|set|handler|listener)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi,
        ''
      );
    if (cleaned === prev) break;
  }

  cleaned = cleaned.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (_full, rawAttrs: string, cssBody: string) => {
      const { attrs } = sanitizeSvgTagAttributes(rawAttrs);
      const safeCss = sanitizeCssText(cssBody, false).replace(/</g, '');
      return `<style${attrs}>${safeCss}</style>`;
    }
  );

  cleaned = cleaned.replace(
    /<(\/?[a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    (_full, tagName: string, rawAttrs: string) => {
      if (tagName.startsWith('/')) {
        return `</${tagName.slice(1)}>`;
      }
      const { attrs, selfClosing } = sanitizeSvgTagAttributes(rawAttrs);
      return `<${tagName}${attrs}${selfClosing ? '/>' : '>'}`;
    }
  );

  cleaned = cleaned.trim();
  if (!/^<svg(?:\s|>)/i.test(cleaned) || !/<\/svg\s*>$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Extract an inline /* icon:start * / ... /* icon:end * / or <!-- icon: ... --> SVG from artifact content if present.
 */
export function extractIconFromContent(content: string): string | null {
  const blockMatch = content.match(
    /\/\*+\s*icon:start\s*\*+\/([\s\S]*?)\/\*+\s*icon:end\s*\*+\//i
  );
  if (blockMatch) {
    const svgMatch = blockMatch[1].match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) return sanitizeSvgMarkup(svgMatch[0]);
  }
  const htmlCommentMatch = content.match(
    /<!--\s*icon:start\s*-->([\s\S]*?)<!--\s*icon:end\s*-->/i
  );
  if (htmlCommentMatch) {
    const svgMatch = htmlCommentMatch[1].match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) return sanitizeSvgMarkup(svgMatch[0]);
  }
  return null;
}

/**
 * Deterministic custom SVG emblem generator so every new artifact gets its own distinct logo
 * even when no raw <svg> string was explicitly passed.
 */
export function generateDeterministicArtifactSvg(seed: {
  slug: string;
  title: string;
  type: ArtifactType;
  tags?: string[];
}): string {
  const slug = seed.slug.toLowerCase();
  if (SLUG_ICON_MAP[slug] && ARTIFACT_ICON_PRESETS[SLUG_ICON_MAP[slug]]) {
    return ARTIFACT_ICON_PRESETS[SLUG_ICON_MAP[slug]];
  }

  for (const tag of seed.tags || []) {
    if (tag.startsWith('icon:')) {
      const presetKey = tag.slice(5).trim();
      if (ARTIFACT_ICON_PRESETS[presetKey]) {
        return ARTIFACT_ICON_PRESETS[presetKey];
      }
    }
  }

  // Keyword matching on slug/title
  const text = `${slug} ${seed.title.toLowerCase()}`;
  if (text.includes('latex') || text.includes('arxiv') || text.includes('paper')) {
    return ARTIFACT_ICON_PRESETS['latex-paper'];
  }
  if (text.includes('multi-approach') || text.includes('multitrack') || text.includes('parallel')) {
    return ARTIFACT_ICON_PRESETS['multi-approach'];
  }
  if (text.includes('grpo') || text.includes('deepseek')) {
    return ARTIFACT_ICON_PRESETS['grpo-rl'];
  }
  if (text.includes('roadmap') || text.includes('sprint') || text.includes('milestone')) {
    return ARTIFACT_ICON_PRESETS['roadmap-tracker'];
  }
  if (text.includes('qwen') || text.includes('coder') || text.includes('eval')) {
    return ARTIFACT_ICON_PRESETS['coder-eval'];
  }
  if (text.includes('blog') || text.includes('engine')) {
    return ARTIFACT_ICON_PRESETS['engine-blog'];
  }
  if (
    text.includes('three') ||
    text.includes('3d') ||
    text.includes('webgl') ||
    text.includes('webgpu') ||
    text.includes('kinematic')
  ) {
    return ARTIFACT_ICON_PRESETS['scene-3d'];
  }

  // Hash-based unique geometric emblem for any custom artifact
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }

  const palettes = [
    { bg: '#223026', fg: '#8FA28A', acc: '#C8A96B', ink: '#F7F4ED' },
    { bg: '#F4EAD5', fg: '#735C2B', acc: '#55684F', ink: '#2A2110' },
    { bg: '#1E2832', fg: '#7C93A8', acc: '#C8A96B', ink: '#ECEAE3' },
    { bg: '#2B211E', fg: '#D98068', acc: '#C8A96B', ink: '#F7F4ED' },
    { bg: '#E4EADF', fg: '#435340', acc: '#B4553F', ink: '#1E2420' },
  ];
  const pal = palettes[hash % palettes.length];
  const initial = (seed.title.replace(/[^a-zA-Z0-9]/g, '')[0] || 'A').toUpperCase();
  const shapeVariant = hash % 3;

  const deco =
    shapeVariant === 0
      ? `<circle cx="23.5" cy="8.5" r="3" fill="${pal.acc}"/>`
      : shapeVariant === 1
      ? `<path d="M21 6.5L25.5 11L21 15.5L16.5 11L21 6.5Z" fill="${pal.acc}"/>`
      : `<rect x="20" y="6" width="6" height="6" rx="1.5" fill="${pal.acc}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="${pal.bg}"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="${pal.fg}" stroke-opacity="0.55"/>
  <path d="M6 24.5H26" stroke="${pal.fg}" stroke-width="1.8" stroke-linecap="round" opacity="0.65"/>
  ${deco}
  <text x="11.5" y="21" font-family="'IBM Plex Mono', monospace" font-size="14" font-weight="600" fill="${pal.ink}">${initial}</text>
</svg>`;
}

/**
 * Resolve an artifact's icon field or fallback to a bespoke SVG string.
 */
export function resolveArtifactIconSvg(artifact: {
  slug: string;
  title: string;
  type: ArtifactType;
  tags?: string[];
  icon?: string;
  content?: string;
}): string {
  const raw = (artifact.icon || '').trim();
  if (/<svg/i.test(raw) && /<\/svg>/i.test(raw)) {
    const sanitized = sanitizeSvgMarkup(raw);
    if (sanitized) return sanitized;
  }
  if (raw && ARTIFACT_ICON_PRESETS[raw]) {
    return ARTIFACT_ICON_PRESETS[raw];
  }
  if (artifact.content) {
    const extracted = extractIconFromContent(artifact.content);
    if (extracted) return extracted;
  }
  return generateDeterministicArtifactSvg(artifact);
}

/**
 * Convert an SVG string to a browser-ready data:image/svg+xml URI.
 */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}
