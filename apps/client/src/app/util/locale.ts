/**
 * Active build-time locale, derived from `$localize.locale` (set by Angular's
 * localize runtime in the Hebrew build). Defaults to `en-US` in the untranslated
 * English build where `$localize` has no locale.
 */
export const CURRENT_LOCALE =
  (typeof $localize !== 'undefined' && $localize.locale) || 'en-US';

/** True in the Hebrew (`/he/`) build. */
export const IS_HEBREW = CURRENT_LOCALE.startsWith('he');

/** Prefix an app-absolute path with `/he` when running the Hebrew build. */
export function localizePath(p: string): string {
  return IS_HEBREW ? '/he' + p : p;
}

/**
 * The user's persisted locale preference, or null if unset/unreadable
 * (convention: `util/review-storage.ts`).
 */
export function readPreferredLocale(): string | null {
  try {
    return localStorage.getItem('preferredLocale');
  } catch {
    // Storage unavailable (private mode, disabled) — treat as no preference.
    return null;
  }
}

/** Persist the user's locale preference; swallow storage errors. */
export function writePreferredLocale(target: 'en' | 'he'): void {
  try {
    localStorage.setItem('preferredLocale', target);
  } catch {
    // Ignore unavailable storage.
  }
}

/**
 * Session-scoped flag set when the Hebrew bundle turned out not to be physically
 * served for a `/he` path (dev serve, or a broken `/he` deploy). It suppresses
 * further `/he` redirects for the rest of the tab session so the toggle no-ops
 * instead of flickering `/` ↔ `/he`, WITHOUT touching the durable
 * `preferredLocale` (prod, where `/he` exists, still honors it next session).
 */
const HE_UNAVAILABLE_KEY = 'heBundleUnavailable';

/** True if the Hebrew bundle was found missing earlier this tab session. */
export function heBundleUnavailableThisSession(): boolean {
  try {
    return sessionStorage.getItem(HE_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record that the Hebrew bundle isn't served here for this tab session. */
export function markHeBundleUnavailable(): void {
  try {
    sessionStorage.setItem(HE_UNAVAILABLE_KEY, '1');
  } catch {
    // Ignore unavailable storage.
  }
}

/**
 * The current URL rebuilt for `target`'s build: English at the root, Hebrew under
 * `/he`. The `|| '/'` guards the *path* (not path+search) so bare `/he?x=1` still
 * yields an absolute `/` rather than a relative URL that would loop. Search + hash
 * are preserved.
 */
export function localeUrl(target: 'en' | 'he'): string {
  const stripped = location.pathname.replace(/^\/he(?=\/|$)/, '') || '/';
  return (
    (target === 'he' ? '/he' + stripped : stripped) +
    location.search +
    location.hash
  );
}

/** Toggle to the other build, persisting the choice, via a full-page navigation. */
export function switchLocale(): void {
  const target = IS_HEBREW ? 'en' : 'he';
  // If the Hebrew bundle already proved unavailable this session, switching to
  // it would just bounce back to English — skip the no-op navigation/flicker.
  if (target === 'he' && heBundleUnavailableThisSession()) {
    return;
  }
  writePreferredLocale(target);
  location.assign(localeUrl(target));
}
