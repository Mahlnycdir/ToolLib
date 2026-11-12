// Entry point: load the texts, start the shell, then register the service worker for offline use.
import { initI18n } from './i18n/i18n.js';
import { startShell } from './shell/shell.js';
import { registerPWA } from './services/pwa.js';
import { startTheme } from './services/theme.js';

startTheme();

await initI18n();
startShell(document.getElementById('app'));
registerPWA();
