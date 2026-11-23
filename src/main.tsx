import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initFirebase } from './firebase.ts';
import './index.css';

// Google Maps Platform Demo Key Quota Defense (Tier 1)
function notifyGmpQuotaExceeded() {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

const gmpWindow = window as unknown as { gm_authFailure?: () => void };
const prevAuthFailure = gmpWindow.gm_authFailure;
gmpWindow.gm_authFailure = () => {
  notifyGmpQuotaExceeded();
  if (typeof prevAuthFailure === 'function') {
    prevAuthFailure();
  }
};

const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  if (/OverQuotaMapError|QuotaExceededError|REQUEST_DENIED|OVER_QUERY_LIMIT/i.test(joined)) {
    notifyGmpQuotaExceeded();
  }
  origConsoleError(...args);
};

void initFirebase();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
