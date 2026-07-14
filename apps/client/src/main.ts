import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import {
  IS_HEBREW,
  heBundleUnavailableThisSession,
  localeUrl,
  markHeBundleUnavailable,
  readPreferredLocale,
} from './app/util/locale';

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
const pref = readPreferredLocale();
const inHe = /^\/he(\/|$)/.test(location.pathname);
if (inHe && !IS_HEBREW) {
  // English shell served for a /he path → the Hebrew build isn't physically
  // here (dev serve, a broken /he deploy, or a stale service worker serving the
  // old English shell). Return to English for this session and suppress further
  // /he redirects, WITHOUT discarding the durable preferredLocale (prod, where
  // /he exists, still honors it).
  markHeBundleUnavailable();
  location.replace(localeUrl('en'));
} else if (pref === 'he' && !inHe && !heBundleUnavailableThisSession()) {
  location.replace(localeUrl('he'));
} else if (pref === 'en' && inHe) {
  location.replace(localeUrl('en'));
} else {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
