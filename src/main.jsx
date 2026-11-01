import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { initPwaAndServiceWorker } from './lib/localDb.js';
import { flushOfflineQueue } from './lib/api.js';

initPwaAndServiceWorker(() => {
  flushOfflineQueue().catch(() => {});
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
