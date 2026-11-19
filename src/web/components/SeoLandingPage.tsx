import React, { useEffect, useRef } from 'react';
import {
  bindSeoLandingEvents,
  syncSeoLandingTheme,
} from '../seo-landing-dom.js';
import { renderSeoLandingHtml } from '../seo-landing-render.js';

export interface SeoLandingPageProps {
  theme: 'day' | 'night';
  onToggleTheme: () => void;
  isCloudMode: boolean;
  googleEnabled: boolean;
  authenticated: boolean;
  userEmail?: string | null;
  onOpenStudio: () => void;
  onOpenSignIn: () => void;
}

export const SeoLandingPage: React.FC<SeoLandingPageProps> = ({
  theme,
  onToggleTheme,
  isCloudMode,
  googleEnabled,
  authenticated,
  userEmail,
  onOpenStudio,
  onOpenSignIn,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onToggleTheme, onOpenStudio, onOpenSignIn });
  callbacksRef.current = { onToggleTheme, onOpenStudio, onOpenSignIn };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = renderSeoLandingHtml({
      theme,
      isCloudMode,
      googleEnabled,
      authenticated,
      userEmail,
    });

    return bindSeoLandingEvents(el, {
      onToggleTheme: () => callbacksRef.current.onToggleTheme(),
      onOpenStudio: () => callbacksRef.current.onOpenStudio(),
      onOpenSignIn: () => callbacksRef.current.onOpenSignIn(),
    });
  }, [isCloudMode, googleEnabled, authenticated, userEmail]);

  useEffect(() => {
    if (containerRef.current) {
      syncSeoLandingTheme(containerRef.current, theme);
    }
  }, [theme]);

  return <div ref={containerRef} />;
};
