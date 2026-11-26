import React from 'react';
import { createRoot } from 'react-dom/client';
import { DirectionProvider } from '@radix-ui/react-direction';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';
import { flushOfflineQueue } from './lib/api.js';
import { initPwaAndServiceWorker } from './lib/localDb.js';
import { ThemeProvider } from './lib/themeContext.jsx';

initPwaAndServiceWorker(() => {
  flushOfflineQueue().catch(() => {});
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DirectionProvider dir="rtl">
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </DirectionProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
