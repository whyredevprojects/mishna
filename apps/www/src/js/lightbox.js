import PhotoSwipeLightbox from '/photoswipe/photoswipe-lightbox.esm.js';

const lightbox = new PhotoSwipeLightbox({
  gallery: '.about', // the rendered about.md container
  children: 'a.pswp-item',
  pswpModule: () => import('/photoswipe/photoswipe.esm.js'),
});

// The inline image is already the full-res original, so read its real size at open time
// instead of declaring data-pswp-width/height in markup.
// NOTE: valid only while the inline src is the full-res image (see eleventy.config.js).
// naturalWidth is 0 until the image decodes; a pre-decode click no-ops the filter and
// PhotoSwipe falls back to viewport-fit, self-correcting once it loads its own copy —
// a non-issue for already-visible inline images.
lightbox.addFilter('domItemData', (itemData, element) => {
  const img = element.querySelector('img');
  if (img instanceof HTMLImageElement && img.naturalWidth) {
    itemData.width = img.naturalWidth;
    itemData.height = img.naturalHeight;
  }
  return itemData;
});

lightbox.init();
