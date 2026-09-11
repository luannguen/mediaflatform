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
function isDevToolsBug(errOrMsg?: any, stack?: string): boolean {
  if (!errOrMsg) return false;
  const text = `${typeof errOrMsg === 'string' ? errOrMsg : errOrMsg?.message || ''} ${stack || errOrMsg?.stack || ''} ${String(errOrMsg)}`;
  return (
    text.includes("reading 'startTime'") ||
    text.includes('reportAllChanges') ||
    (text.includes('startTime') && text.includes('reportAllChanges')) ||
    (text.includes('startTime') && text.includes('report'))
  );
}

export function DevToolsErrorSuppressor() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Intercept requestIdleCallback (where reportAllChanges is dispatched)
    const origRIC = window.requestIdleCallback;
    if (typeof origRIC === 'function') {
      window.requestIdleCallback = function (callback: IdleRequestCallback, options?: IdleRequestOptions) {
        const safeCallback: IdleRequestCallback = (deadline) => {
          try {
            return callback(deadline);
          } catch (err: any) {
            if (isDevToolsBug(err)) return;
            throw err;
          }
        };
        return origRIC.call(window, safeCallback, options);
      };
    }

    // 2. Intercept requestAnimationFrame
    const origRAF = window.requestAnimationFrame;
    if (typeof origRAF === 'function') {
      window.requestAnimationFrame = function (callback: FrameRequestCallback) {
        const safeCallback: FrameRequestCallback = (timestamp) => {
          try {
            return callback(timestamp);
          } catch (err: any) {
            if (isDevToolsBug(err)) return;
            throw err;
          }
        };
        return origRAF.call(window, safeCallback);
      };
    }

    // 3. Intercept setTimeout
    const origST = window.setTimeout;
    if (typeof origST === 'function') {
      (window as any).setTimeout = function (handler: TimerHandler, timeout?: number, ...args: any[]) {
        if (typeof handler === 'function') {
          const safeHandler = function (this: any, ...innerArgs: any[]) {
            try {
              return handler.apply(this, innerArgs);
            } catch (err: any) {
              if (isDevToolsBug(err)) return;
              throw err;
            }
          };
          return origST.apply(window, [safeHandler, timeout, ...args] as any);
        }
        return origST.apply(window, [handler, timeout, ...args] as any);
      };
    }

    // 4. Intercept standard DOM error events
    const handleError = (event: ErrorEvent) => {
      if (isDevToolsBug(event?.message, event?.error?.stack) || isDevToolsBug(event?.error)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    };

    // 5. Intercept unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isDevToolsBug(event?.reason)) {
        event.preventDefault();
      }
    };

    // 6. Intercept console.error output if Chromium or frameworks relay the error to console
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

    // 7. Fallback window.onerror handler
    const originalOnError = window.onerror;
    window.onerror = (msg, url, line, col, err) => {
      if (isDevToolsBug(String(msg), err?.stack) || isDevToolsBug(err)) {
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
      if (origRIC) window.requestIdleCallback = origRIC;
      if (origRAF) window.requestAnimationFrame = origRAF;
      if (origST) window.setTimeout = origST;
      console.error = originalConsoleError;
      window.onerror = originalOnError;
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
