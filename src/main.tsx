import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { store } from './lib/store';
import { startAutoSync } from './lib/sync';
import { startDeskPhone } from './lib/deskphone';
import { startLeadSources } from './lib/leadsources';
import { startEmail } from './lib/email';
import { startReminders } from './lib/reminders';
import { flushScreenshots } from './lib/screenshots';
import { applyTheme } from './lib/theme';
import { startUpdateChecks } from './lib/updater';
import './styles.css';

applyTheme();

store.load().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  startAutoSync();
  startUpdateChecks();
  startDeskPhone();
  startLeadSources();
  startEmail();
  startReminders();
  setTimeout(() => { flushScreenshots().catch(() => {}); }, 15000); // screenshots that didn't reach the sheet yet
});
