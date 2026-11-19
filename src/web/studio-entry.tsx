import React, { Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const LazyStudioApp = React.lazy(() => import('./App.js'));

let studioRoot: Root | null = null;
let mountedContainer: HTMLElement | null = null;

export function mountStudioApp(container: HTMLElement): void {
  if (studioRoot && mountedContainer === container) {
    return;
  }
  unmountStudioApp();
  mountedContainer = container;
  studioRoot = createRoot(container);
  studioRoot.render(
    <React.StrictMode>
      <Suspense
        fallback={
          <div className="h-screen w-screen bg-canvas text-ink-2 flex items-center justify-center text-[13px]">
            Initializing MyArtifact Studio…
          </div>
        }
      >
        <LazyStudioApp />
      </Suspense>
    </React.StrictMode>
  );
}

export function unmountStudioApp(): void {
  if (studioRoot) {
    studioRoot.unmount();
    studioRoot = null;
  }
  mountedContainer = null;
}
