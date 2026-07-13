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
