<style>
/* theme:start */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
:root{--ma-bg:#F7F4ED;--ma-surface:#FCFBF7;--ma-sunken:#EFEBE1;--ma-border:#E2DDD0;--ma-ink:#1E2420;--ma-muted:#4A524A;--ma-accent:#55684F;--ma-accent-ink:#F7F4ED;--ma-accent-soft:#E4EADF;--ma-highlight:#C8A96B;--ma-highlight-soft:#F8F1E3;--ma-danger:#B4553F;--ma-font-sans:'IBM Plex Sans', system-ui, sans-serif;--ma-font-display:'IBM Plex Sans', system-ui, sans-serif;--ma-font-mono:'IBM Plex Mono', ui-monospace, monospace}
/* theme:end */
body{background:var(--ma-bg)!important;color:var(--ma-ink)!important;font-family:var(--ma-font-sans)}
#md-root{max-width:44rem;--tw-prose-body:var(--ma-ink);--tw-prose-headings:var(--ma-ink);--tw-prose-lead:var(--ma-muted);--tw-prose-links:var(--ma-accent);--tw-prose-bold:var(--ma-ink);--tw-prose-counters:var(--ma-muted);--tw-prose-bullets:var(--ma-muted);--tw-prose-hr:var(--ma-border);--tw-prose-quotes:var(--ma-ink);--tw-prose-quote-borders:var(--ma-highlight);--tw-prose-code:var(--ma-ink);--tw-prose-th-borders:var(--ma-border);--tw-prose-td-borders:var(--ma-border)}
#md-root h1,#md-root h2{font-family:var(--ma-font-display);letter-spacing:-.01em}
#md-root code{font-family:var(--ma-font-mono);background:var(--ma-sunken);padding:.1em .35em;border-radius:4px;font-weight:400}
#md-root code::before,#md-root code::after{content:none}
#md-root blockquote{background:var(--ma-highlight-soft);border-radius:0 8px 8px 0;padding:.6em 1em;font-style:normal}
#md-root blockquote p::before,#md-root blockquote p::after{content:none}
#md-root .my-6{background:var(--ma-surface)!important;border-color:var(--ma-border)!important}
.eyebrow{font-family:var(--ma-font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ma-muted)}
</style>

<p class="eyebrow">Report · October 2026</p>

# Sandbox latency review

> **Summary.** Median time to first render fell from 1.4s to 0.62s after caching compiled React artifacts. Mermaid renders are now the slowest path.

## Findings

| Artifact type | Before | After | Change |
| :-- | --: | --: | --: |
| React | 1.40s | 0.62s | −56% |
| HTML | 0.31s | 0.29s | −6% |
| Mermaid | 0.88s | 0.84s | −5% |
| Markdown | 0.45s | 0.41s | −9% |

1. Babel compilation was 70% of React render time. A content-hash cache removes it on reload.
2. Mermaid loads its full bundle on every render. Lazy-loading diagram types is the next step.

## How a render flows

```mermaid
flowchart LR
  A[Artifact saved] --> B{Hash cached?}
  B -- yes --> C[Load compiled module]
  B -- no --> D[Babel compile] --> E[Store by hash] --> C
  C --> F[Render in sandbox]
```

## Next steps

- [ ] Lazy-load Mermaid diagram renderers
- [ ] Add render timing to the State tab
- [x] Cache compiled React output by content hash
