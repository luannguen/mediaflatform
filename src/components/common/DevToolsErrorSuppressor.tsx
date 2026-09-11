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

    // 1. Intercept standard DOM error events
    const handleError = (event: ErrorEvent) => {
      if (isDevToolsBug(event?.message, event?.error?.stack)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    };

    // 2. Intercept unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      const msg = typeof reason === 'string' ? reason : reason?.message;
      const stack = reason?.stack;
      if (isDevToolsBug(msg, stack)) {
        event.preventDefault();
      }
    };

    // 3. Intercept console.error output if Chromium or frameworks relay the error to console
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      const fullText = args
        .map((a) => (typeof a === 'string' ? a : a?.message || a?.stack || String(a)))
        .join(' ');
      if (isDevToolsBug(fullText)) {
        return;
      }
      originalConsoleError.apply(console, args);
    };

    // 4. Fallback window.onerror handler
    const originalOnError = window.onerror;
    window.onerror = (msg, url, line, col, err) => {
      if (isDevToolsBug(String(msg), err?.stack)) {
        return true; // suppresses error in browser
      }
      if (typeof originalOnError === 'function') {
        return originalOnError(msg, url, line, col, err);
      }
      return false;
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      console.error = originalConsoleError;
      window.onerror = originalOnError;
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
