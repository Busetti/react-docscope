import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-docscope/styles.css';
import './playground.css';
import { App } from './App';

/**
 * The static (GitHub Pages) build has no dev server, so a service worker
 * plays the demo backend (signed URLs, auth headers, error statuses).
 */
async function startDemoBackend() {
  if (import.meta.env.VITE_DEMO_SW !== '1' || !('serviceWorker' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL;
    await navigator.serviceWorker.register(`${base}demo-sw.js`, { scope: base });
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 4000);
      });
    }
  } catch {
    // Scenarios that need the mock backend will show their error states.
  }
}

void startDemoBackend().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
