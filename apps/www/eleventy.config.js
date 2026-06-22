/**
 * Eleventy config for the public marketing site (apps/www) — the apex
 * getchevrasmishnayos.com front door. The Angular app lives at app.getchevrasmishnayos.com.
 *
 * The admin-editable "general info" copy lives in src/content/about.md as **pure
 * Markdown with no front matter**, so the in-app Toast UI editor (which commits the raw
 * Markdown via the GitHub Contents API) can never break it. A directory data file
 * (src/content/content.11tydata.json) gives that file the site layout + the "/" permalink,
 * so about.md *is* the homepage body. The header (Log in / Sign up) and the join CTA are
 * fixed chrome in _includes/layout.njk; the app URLs are centralized in _data/site.json.
 *
 * Markdown template processing is disabled (markdownTemplateEngine: false) so admin
 * content is never run through Nunjucks — stray `{{ }}`/`{% %}` in the copy stays literal.
 *
 * Monorepo hoisting note: dependencies resolve from the *root* node_modules (not
 * apps/www/node_modules). Keep passthrough-copy paths relative to this project root.
 */
module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'src/css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'src/js': 'js' });

  // Self-host PhotoSwipe's browser-ready ESM + CSS (no bundler). Source path is
  // relative to this project root; deps hoist to the *root* node_modules.
  eleventyConfig.addPassthroughCopy({
    '../../node_modules/photoswipe/dist': 'photoswipe',
  });

  // Wrap every Markdown image in an anchor so the content images become a PhotoSwipe
  // gallery (see src/js/lightbox.js). The admin authors plain `![alt](url)` only, so the
  // wrapper must be generated here — nothing is required of the author. We extend
  // Eleventy's own markdown-it instance rather than registering a second one.
  eleventyConfig.amendLibrary('md', (md) => {
    const defaultImageRenderer =
      md.renderer.rules.image ??
      ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const imgHtml = defaultImageRenderer(tokens, idx, options, env, self);
      const src = tokens[idx].attrGet('src') ?? '';
      // href === src: the inline <img> IS the full-res original, so the lightbox opens
      // the same file. PhotoSwipe loads its own <img> for the zoom view, so the href is
      // required even though it equals src. This is correct only while the inline src is
      // the full-res image; if inline images ever switch to a Cloudflare-resized variant,
      // naturalWidth would report the thumbnail size (see lightbox.js) and dimensions
      // would have to come from R2 metadata at build time instead.
      return `<a href="${src}" class="pswp-item">${imgHtml}</a>`;
    };
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    markdownTemplateEngine: false,
    htmlTemplateEngine: 'njk',
  };
};
