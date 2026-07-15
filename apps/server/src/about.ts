/**
 * About-page editor backend. Reads and commits the `www` site's editable Markdown
 * (`about.md`) through the GitHub Contents API, so an admin can edit the marketing
 * site's "general info" copy from inside the Angular admin area without a manual
 * deploy. The only caller is the admin editor (`apps/client` `/admin/about`); both
 * routes are gated by `requireAdmin` in `index.ts`.
 *
 * Repo coordinates (owner/repo/branch/path) come from this monorepo's own git remote,
 * frozen into `wrangler.toml` `[vars]` — a Worker can't read git at runtime, and this
 * is deliberately *not* a user-configurable "separate repo". The GitHub token is a
 * Worker secret (`GITHUB_TOKEN`). Missing config fails loudly (`AboutConfigError`)
 * rather than silently — the route maps it to a 500 with a helpful message.
 *
 * Images never touch the GitHub repo; the editor uploads them to R2 (see the
 * `/api/admin/about/image` route in `index.ts`).
 */

/** Thrown when a required env var / secret is absent. The route surfaces it as a 500. */
export class AboutConfigError extends Error {}

/**
 * The www site is bilingual (`/en`, `/he`), each locale its own `about.md`. The editor
 * commits to one at a time; the client picks which via the locale it sends.
 */
export type AboutLocale = 'en' | 'he';

interface GithubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
}

/**
 * Reads the GitHub config from env for the given locale, throwing `AboutConfigError` if
 * anything is missing. The `about.md` path is resolved per locale: Hebrew commits to
 * `ABOUT_MD_PATH_HE`, English (the default) to `ABOUT_MD_PATH`.
 */
function githubConfig(env: Env, locale: AboutLocale): GithubConfig {
  const pathVar: keyof Env = locale === 'he' ? 'ABOUT_MD_PATH_HE' : 'ABOUT_MD_PATH';
  const cfg: GithubConfig = {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH,
    path: env[pathVar] as string,
    token: env.GITHUB_TOKEN,
  };
  const missing = (Object.keys(cfg) as (keyof GithubConfig)[]).filter(
    (k) => !cfg[k],
  );
  if (missing.length > 0) {
    const names = missing
      .map((k) => (k === 'path' ? pathVar : keyToEnvName[k]))
      .join(', ');
    throw new AboutConfigError(
      `About editor is not configured: missing ${names}. ` +
        'Set the GitHub coordinates in apps/server/wrangler.toml [vars] and the ' +
        'GITHUB_TOKEN secret (wrangler secret put GITHUB_TOKEN).',
    );
  }
  return cfg;
}

const keyToEnvName: Record<keyof GithubConfig, string> = {
  owner: 'GITHUB_OWNER',
  repo: 'GITHUB_REPO',
  branch: 'GITHUB_BRANCH',
  path: 'ABOUT_MD_PATH',
  token: 'GITHUB_TOKEN',
};

function contentsUrl(cfg: GithubConfig): string {
  // The path keeps its slashes as GitHub path separators (about.md's path has only
  // safe characters), so it's embedded verbatim rather than encodeURIComponent'd.
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    // GitHub rejects API requests without a User-Agent.
    'user-agent': 'chevra-mishnayos-about-editor',
    'x-github-api-version': '2022-11-28',
  };
}

/** UTF-8 → base64 (btoa is latin1-only, so encode bytes first). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** base64 → UTF-8 (GitHub wraps its base64 in newlines; strip them first). */
function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Fetches the file's current blob SHA, or `null` if it doesn't exist yet. */
async function currentSha(cfg: GithubConfig): Promise<string | null> {
  const res = await fetch(
    `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: ghHeaders(cfg.token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { sha?: string };
  return body.sha ?? null;
}

/** Reads the current Markdown. Returns `''` if the file doesn't exist yet. */
export async function readAbout(env: Env, locale: AboutLocale): Promise<string> {
  const cfg = githubConfig(env, locale);
  const res = await fetch(
    `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`,
    { headers: ghHeaders(cfg.token) },
  );
  if (res.status === 404) return '';
  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { content?: string };
  return body.content ? fromBase64(body.content) : '';
}

/**
 * Surrounds any standalone HTML-tag line (e.g. `<br>`) with blank lines.
 *
 * The `www` site renders `about.md` with markdown-it under `html: true`, where
 * CommonMark treats a bare HTML tag alone on a line as the start of an *HTML block*
 * that swallows every following line until the next blank line — so Markdown written
 * right after a `<br>` (a heading, bold, an image) comes out as raw text. The Toast UI
 * editor emits such `<br>` spacers without a trailing blank line, so normalize here, at
 * the single save chokepoint, before committing. Idempotent, and leaves the contents of
 * fenced code blocks alone.
 */
export function isolateHtmlBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const isLoneTag = !inFence && /^<[^>]+>$/.test(trimmed);
    if (isLoneTag && out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push('');
    }
    out.push(line);
    if (isLoneTag && i + 1 < lines.length && lines[i + 1].trim() !== '') {
      out.push('');
    }
  }
  return out.join('\n');
}

/**
 * Commits new Markdown to the about file. Looks up the current SHA first (required
 * to update an existing file; omitted to create one), so the first save also works.
 * The commit to `main` triggers CI, which rebuilds and deploys the `www` site.
 */
export async function writeAbout(
  env: Env,
  locale: AboutLocale,
  markdown: string,
): Promise<void> {
  const cfg = githubConfig(env, locale);
  const sha = await currentSha(cfg);
  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'chore(about): update via admin',
      content: toBase64(isolateHtmlBlocks(markdown)),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  }
}

/** Sanitizes an uploaded filename into a safe R2 key suffix. */
export function safeFilename(name: string | undefined): string {
  if (!name) return 'image';
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'image';
}
