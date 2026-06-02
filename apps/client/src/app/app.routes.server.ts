import { RenderMode, ServerRoute } from '@angular/ssr';

// This is an interactive, authenticated SPA built on Web Awesome custom
// elements. Client rendering avoids prerender-time API calls (no server/cookies
// available at build) and shadow-DOM hydration mismatches. The Angular SSR
// host still serves the shell; the app boots in the browser.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
