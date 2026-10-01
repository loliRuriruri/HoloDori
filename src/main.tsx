import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import * as ViewerModule from './viewer';

// Expose viewer runtime module for headless acceptance testing and debugging
if (typeof window !== 'undefined') {
  (window as unknown as { __HDM_VIEWER__: typeof ViewerModule }).__HDM_VIEWER__ = ViewerModule;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
