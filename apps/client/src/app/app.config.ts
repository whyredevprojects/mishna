import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { SwRecoveryService, isChunkLoadError } from './services/sw-recovery.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    // A lazy route whose chunk fails to load (typically a stale Service Worker
    // serving a dead `/admin/*` chunk) recovers itself: SwRecoveryService does a
    // one-shot, guarded reload onto the fresh shell. See its doc comment.
    provideRouter(
      appRoutes,
      withNavigationErrorHandler((e) => {
        if (isChunkLoadError(e.error)) {
          inject(SwRecoveryService).recoverFromChunkError();
        }
      }),
    ),
    // Wire Service-Worker recovery at app startup (root scope, always-on).
    provideAppInitializer(() => inject(SwRecoveryService).init()),
    // In-memory cache + request dedup for the REST API. Defaults keep a fetched
    // response "fresh" for 30s (no refetch on revisit) and retained for 5min
    // after the last subscriber; per-query overrides live in `queries/queries.ts`.
    provideTanStackQuery(
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
          },
        },
      }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
