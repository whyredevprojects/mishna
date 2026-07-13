import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Register the Web Awesome custom elements used across the app. These imports
// live in the browser entry only — `customElements.define` touches `HTMLElement`,
// which doesn't exist during Node SSR (see main.server.ts). The templates compile
// regardless because each component declares CUSTOM_ELEMENTS_SCHEMA.
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/button-group/button-group.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/divider/divider.js';
import '@awesome.me/webawesome/dist/components/drawer/drawer.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tag/tag.js';

// Persisted locale preference: before bootstrapping, honor a stored choice by
// redirecting to the matching build (English at `/`, Hebrew at `/he/`). This
// ships in both builds; the guard prevents a redirect loop by only acting when
// the current path's locale doesn't match the preference.
const pref = localStorage.getItem('preferredLocale');
const inHe = /^\/he(\/|$)/.test(location.pathname);
if (pref === 'he' && !inHe) {
  location.replace('/he' + location.pathname + location.search);
} else if (pref === 'en' && inHe) {
  location.replace(
    location.pathname.replace(/^\/he(?=\/|$)/, '') + location.search || '/',
  );
} else {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
