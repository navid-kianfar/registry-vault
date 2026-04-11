import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles/globals.css';

// Register service worker; show a banner when an update is available
registerSW({
  onNeedRefresh() {
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%)',
      'display:flex;align-items:center;gap:0.75rem',
      'background:#1e40af;color:white;padding:0.75rem 1.25rem',
      'border-radius:0.5rem;box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'font-size:0.875rem;font-family:system-ui,sans-serif;z-index:99999',
    ].join(';');
    banner.innerHTML = `
      <span>A new version is available.</span>
      <button id="pwa-reload" style="background:white;color:#1e40af;border:none;border-radius:0.375rem;padding:0.375rem 0.875rem;font-weight:600;cursor:pointer;font-size:0.8125rem">Reload</button>
      <button id="pwa-dismiss" style="background:transparent;color:rgba(255,255,255,0.7);border:none;cursor:pointer;font-size:1rem;padding:0">✕</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('pwa-reload')?.addEventListener('click', () => window.location.reload());
    document.getElementById('pwa-dismiss')?.addEventListener('click', () => banner.remove());
  },
  onOfflineReady() {
    console.info('[PWA] App ready for offline use');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
