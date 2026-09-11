'use client';

import { useEffect } from 'react';

/**
 * DevToolsErrorSuppressor
 *
 * Suppresses known benign internal Chromium DevTools performance measurement exceptions:
 * "TypeError: Cannot read properties of undefined (reading 'startTime') at et.reportAllChanges"
 *
 * This bug occurs exclusively in Chromium DevTools (v128-v134+) when Live Metrics / Core Web Vitals
 * soft-navigation monitoring executes on requestIdleCallback during Next.js client-side route transitions.
 * It has zero impact on application runtime or user data, but clutters the console with scary red errors.
 */
export function DevToolsErrorSuppressor() {
  useEffect(() => {
    const isDevToolsBug = (msg?: string, stack?: string) => {
      const text = `${msg || ''} ${stack || ''}`;
      return (
        text.includes("reading 'startTime'") ||
        text.includes('reportAllChanges') ||
        (text.includes('startTime') && text.includes('reportAllChanges'))
      );
    };

    const handleError = (event: ErrorEvent) => {
      if (isDevToolsBug(event?.message, event?.error?.stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      const msg = typeof reason === 'string' ? reason : reason?.message;
      const stack = reason?.stack;
      if (isDevToolsBug(msg, stack)) {
        event.preventDefault();
      }
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
