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
