import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';
import { DevToolsErrorSuppressor } from '@/components/common/DevToolsErrorSuppressor';

export const metadata: Metadata = {
  title: 'Media Platform | Independent DAM & Asset Infrastructure',
  description: 'Enterprise Headless Digital Asset Management with Zero-Trust Multi-Tenancy',
};

const DEVTOOLS_SUPPRESSION_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;

  function isDevToolsError(err) {
    if (!err) return false;
    var str = '';
    try {
      str = String(err.message || '') + ' ' + String(err.stack || '') + ' ' + String(err);
    } catch (_) {
      str = String(err);
    }
    return (
      str.indexOf("reading 'startTime'") !== -1 ||
      str.indexOf('reportAllChanges') !== -1 ||
      (str.indexOf('startTime') !== -1 && str.indexOf('report') !== -1)
    );
  }

  // 1. Intercept requestIdleCallback (where reportAllChanges is dispatched)
  var origRIC = window.requestIdleCallback;
  if (typeof origRIC === 'function') {
    window.requestIdleCallback = function (cb, options) {
      var safeCb = function (deadline) {
        try {
          return cb(deadline);
        } catch (err) {
          if (isDevToolsError(err)) return;
          throw err;
        }
      };
      return origRIC.call(window, safeCb, options);
    };
  }

  // 2. Intercept requestAnimationFrame
  var origRAF = window.requestAnimationFrame;
  if (typeof origRAF === 'function') {
    window.requestAnimationFrame = function (cb) {
      var safeCb = function (timestamp) {
        try {
          return cb(timestamp);
        } catch (err) {
          if (isDevToolsError(err)) return;
          throw err;
        }
      };
      return origRAF.call(window, safeCb);
    };
  }

  // 3. Intercept setTimeout
  var origST = window.setTimeout;
  if (typeof origST === 'function') {
    window.setTimeout = function (handler, timeout) {
      var args = Array.prototype.slice.call(arguments, 2);
      if (typeof handler === 'function') {
        var safeHandler = function () {
          try {
            return handler.apply(this, arguments);
          } catch (err) {
            if (isDevToolsError(err)) return;
            throw err;
          }
        };
        return origST.apply(window, [safeHandler, timeout].concat(args));
      }
      return origST.apply(window, arguments);
    };
  }

  // 4. Intercept console.error
  var origConsoleError = console.error;
  console.error = function () {
    var args = Array.prototype.slice.call(arguments);
    var full = args.map(function (a) { return typeof a === 'string' ? a : (a && (a.message || a.stack)) || String(a); }).join(' ');
    if (isDevToolsError(full)) return;
    origConsoleError.apply(console, args);
  };

  // 5. Intercept window.onerror and error event
  var origOnError = window.onerror;
  window.onerror = function (msg, url, line, col, err) {
    if (isDevToolsError(err) || (msg && isDevToolsError(msg))) {
      return true;
    }
    if (typeof origOnError === 'function') {
      return origOnError.apply(this, arguments);
    }
    return false;
  };

  window.addEventListener(
    'error',
    function (event) {
      if (isDevToolsError(event.error) || (event.message && isDevToolsError(event.message))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    if (isDevToolsError(event.reason)) {
      event.preventDefault();
    }
  });
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          id="devtools-error-suppressor-inline"
          dangerouslySetInnerHTML={{ __html: DEVTOOLS_SUPPRESSION_SCRIPT }}
        />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <DevToolsErrorSuppressor />
        {children}
        <Toaster position="top-right" richColors theme="dark" />
      </body>
    </html>
  );
}
