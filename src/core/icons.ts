import type { ArtifactType } from './types.js';

/**
 * Official MyArtifact Brand Logo (32x32 SVG).
 * Isometric layered artifact plates forming an "M" monogram with a warm brass keystone spark.
 */
export const MYARTIFACT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#2A362B"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#55684F" stroke-opacity="0.65"/>
  <!-- Bottom version layer -->
  <path d="M6 21.5L16 26.5L26 21.5" stroke="#8FA28A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>
  <!-- Middle version layer -->
  <path d="M6 17.2L16 22.2L26 17.2" stroke="#C8A96B" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Top isometric M-prism -->
  <path d="M6.5 12.2L16 7.2L25.5 12.2L16 17.2L6.5 12.2Z" fill="#55684F" stroke="#F7F4ED" stroke-width="1.7" stroke-linejoin="round"/>
  <!-- M monogram fold inside top plate -->
  <path d="M11.5 13.2V10.5L16 13.2L20.5 10.5V13.2" stroke="#F7F4ED" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Brass keystone spark -->
  <circle cx="16" cy="7.2" r="2" fill="#C8A96B" stroke="#2A362B" stroke-width="0.8"/>
</svg>`;

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
};

/**
 * Extract an inline /* icon:start * / ... /* icon:end * / or <!-- icon: ... --> SVG from artifact content if present.
 */
export function extractIconFromContent(content: string): string | null {
  const blockMatch = content.match(
    /\/\*+\s*icon:start\s*\*+\/([\s\S]*?)\/\*+\s*icon:end\s*\*+\//i
  );
  if (blockMatch) {
    const svgMatch = blockMatch[1].match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) return svgMatch[0].trim();
  }
  const htmlCommentMatch = content.match(
    /<!--\s*icon:start\s*-->([\s\S]*?)<!--\s*icon:end\s*-->/i
  );
  if (htmlCommentMatch) {
    const svgMatch = htmlCommentMatch[1].match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) return svgMatch[0].trim();
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
  if (raw.startsWith('<svg') && raw.includes('</svg>')) {
    return raw;
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
