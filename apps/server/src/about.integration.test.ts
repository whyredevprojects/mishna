import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import '.';

// The AUTH service binding is stubbed in vitest.config.mts: the forwarded `cookie`
// value is the user id, and only cookie 'admin' is flagged isAdmin. So 'alice' is an
// authenticated non-admin and 'admin' clears requireAdmin.
function as(userId: string): HeadersInit {
  return { cookie: userId };
}

describe('about-page editor endpoints', () => {
  it('rejects non-admin callers with 403', async () => {
    const get = await SELF.fetch('https://server/api/admin/about', {
      headers: as('alice'),
    });
    expect(get.status).toBe(403);

    const post = await SELF.fetch('https://server/api/admin/about', {
      method: 'POST',
      headers: { ...as('alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: 'hi' }),
    });
    expect(post.status).toBe(403);

    const image = await SELF.fetch('https://server/api/admin/about/image', {
      method: 'POST',
      headers: { ...as('alice'), 'content-type': 'image/png' },
      body: 'x',
    });
    expect(image.status).toBe(403);
  });

  // GITHUB_TOKEN is a secret with no value in tests, so the config check fails before
  // any network call — proving the handler fails loudly rather than silently.
  it('fails loudly (500) when the GitHub token is not configured', async () => {
    const get = await SELF.fetch('https://server/api/admin/about', {
      headers: as('admin'),
    });
    expect(get.status).toBe(500);
    expect((await get.json<{ error: string }>()).error).toMatch(/GITHUB_TOKEN/);

    const post = await SELF.fetch('https://server/api/admin/about', {
      method: 'POST',
      headers: { ...as('admin'), 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: '# hello' }),
    });
    expect(post.status).toBe(500);
    expect((await post.json<{ error: string }>()).error).toMatch(/GITHUB_TOKEN/);
  });

  it('rejects a save with a non-string body as 400', async () => {
    const res = await SELF.fetch('https://server/api/admin/about', {
      method: 'POST',
      headers: { ...as('admin'), 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: 42 }),
    });
    expect(res.status).toBe(400);
  });

  // The ABOUT_BUCKET R2 binding + R2_PUBLIC_BASE_URL are provisioned in wrangler.toml,
  // so the image route stores the upload and returns its public URL (built from the
  // base URL + the generated `about/<uuid>-<safe-name>` key).
  it('stores an uploaded image and returns its public URL', async () => {
    const res = await SELF.fetch('https://server/api/admin/about/image', {
      method: 'POST',
      headers: {
        ...as('admin'),
        'content-type': 'image/png',
        'x-filename': 'logo.png',
      },
      body: 'x',
    });
    expect(res.status).toBe(200);
    expect((await res.json<{ url: string }>()).url).toMatch(
      /^https:\/\/images\.getchevrasmishnayos\.com\/about\/[0-9a-f-]+-logo\.png$/,
    );
  });

  it('rejects an empty image body as 400', async () => {
    const res = await SELF.fetch('https://server/api/admin/about/image', {
      method: 'POST',
      headers: { ...as('admin'), 'content-type': 'image/png' },
    });
    expect(res.status).toBe(400);
  });
});
