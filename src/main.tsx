import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import * as ViewerModule from './viewer';
import { DesktopCharacterWindow } from './desktop';

// Expose viewer runtime module for headless acceptance testing and debugging
if (typeof window !== 'undefined') {
  (window as unknown as { __HDM_VIEWER__: typeof ViewerModule }).__HDM_VIEWER__ = ViewerModule;
}

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const isDesktop = params?.get('window') === 'desktop';

import { I18nProvider } from './i18n';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {isDesktop ? <DesktopCharacterWindow /> : <App />}
    </I18nProvider>
  </React.StrictMode>
);
