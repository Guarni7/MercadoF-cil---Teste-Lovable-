import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { ErrorBoundary } from '@/components/ErrorBoundary.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// Service Worker só em produção. Em desenvolvimento ele servia cópias antigas dos módulos (e do
// app shell) do cache quando a rede falhava, então o localhost rodava código velho e o HMR quebrava.
// Em dev, além de não registrar, remove o Service Worker e os caches deixados por sessões anteriores.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
