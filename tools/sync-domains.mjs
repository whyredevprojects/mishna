#!/usr/bin/env node
/**
 * Single-source-of-truth domain sync.
 *
 * `config/domains.json` is the one place the app's domain lives. This script
 * propagates its values into the handful of files that can't read that JSON at
 * build time (wrangler.toml routes/vars, the Flutter dart-define defaults, the
 * Eleventy site data, and the Angular Turnstile key). The Angular client itself
 * needs nothing — it uses relative `/api/*` URLs — and apps/login derives its
 * trusted origin from BETTER_AUTH_URL at runtime, so neither is touched here.
 *
 *   node tools/sync-domains.mjs            # write the derived values into the files
 *   node tools/sync-domains.mjs --check    # exit 1 if any file is out of sync (CI)
 *
 * Edits are field-anchored (match a key/var name, replace only its value), so the
 * rest of each file — comments included — is left exactly as-is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const cfg = JSON.parse(readFileSync(join(repoRoot, 'config/domains.json'), 'utf8'));
const appOrigin = `https://${cfg.appHost}`;
const imagesOrigin = `https://${cfg.imagesHost}`;

/**
 * One field-anchored replacement. `regex` must contain exactly two capture
 * groups bracketing the value (prefix, suffix) and must match exactly once.
 */
const edit = (label, regex, value) => ({ label, regex, value });

/** Build the new content for a file by applying every edit, asserting each hits once. */
function apply(relPath, edits) {
  const abs = join(repoRoot, relPath);
  let content = readFileSync(abs, 'utf8');
  for (const { label, regex, value } of edits) {
    let hits = 0;
    content = content.replace(regex, (_m, pre, suf) => {
      hits++;
      return `${pre}${value}${suf}`;
    });
    if (hits !== 1) {
      throw new Error(
        `sync-domains: ${relPath} — anchor "${label}" matched ${hits} times (expected 1). ` +
          `The file's shape changed; update tools/sync-domains.mjs.`,
      );
    }
  }
  return { abs, relPath, content };
}

const targets = [
  apply('apps/login/wrangler.toml', [
    edit('route pattern', /(pattern = ")[^"]*(\/api\/auth\/\*")/, cfg.appHost),
    edit('route zone', /(zone_name = ")[^"]*(")/, cfg.apex),
    edit('BETTER_AUTH_URL', /(BETTER_AUTH_URL = ")[^"]*(")/, appOrigin),
    edit('RESEND_FROM_EMAIL', /(RESEND_FROM_EMAIL = ")[^"]*(")/, cfg.email.auth),
  ]),
  apply('apps/server/wrangler.toml', [
    edit('route pattern', /(pattern = ")[^"]*(\/api\/\*")/, cfg.appHost),
    edit('route zone', /(zone_name = ")[^"]*(")/, cfg.apex),
    edit('APP_ORIGIN', /(APP_ORIGIN = ")[^"]*(")/, appOrigin),
    edit('RESEND_FROM_EMAIL', /(RESEND_FROM_EMAIL = ")[^"]*(")/, cfg.email.reminders),
    edit('R2_PUBLIC_BASE_URL', /(R2_PUBLIC_BASE_URL = ")[^"]*(")/, imagesOrigin),
  ]),
  apply('apps/mobile/lib/core/config.dart', [
    edit('API_BASE_URL', /('API_BASE_URL',\s*defaultValue: ')[^']*(')/, appOrigin),
    edit('TURNSTILE_SITE_KEY', /('TURNSTILE_SITE_KEY',\s*defaultValue: ')[^']*(')/, cfg.turnstileSiteKey),
  ]),
  apply('apps/www/src/_data/site.json', [
    edit('appUrl', /("appUrl": ")[^"]*(")/, appOrigin),
  ]),
  apply('apps/client/src/environments/environment.ts', [
    edit('turnstileSiteKey', /(turnstileSiteKey: ')[^']*(')/, cfg.turnstileSiteKey),
  ]),
];

let drift = false;
for (const { abs, relPath, content } of targets) {
  if (readFileSync(abs, 'utf8') === content) continue;
  drift = true;
  if (check) {
    console.error(`out of sync: ${relPath}`);
  } else {
    writeFileSync(abs, content);
    console.log(`updated: ${relPath}`);
  }
}

if (check && drift) {
  console.error('\nRun `npm run sync:domains` and commit the result.');
  process.exit(1);
}
if (!drift) console.log(check ? 'domains: in sync' : 'domains: nothing to update');
