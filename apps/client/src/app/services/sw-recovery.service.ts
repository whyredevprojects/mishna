import { DestroyRef, Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { ToastService } from './toast.service';

/** sessionStorage flag so an auto-recovery reload can only ever happen once per tab. */
const RELOAD_GUARD_KEY = 'sw-recovery-reloaded';

/** Substrings that identify a failed lazy-chunk / dynamic-import load. */
const CHUNK_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Loading chunk',
  'error loading dynamically imported module',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'disallowed MIME type',
];

/**
 * Keeps returning users from getting stranded on a broken Angular Service Worker.
 *
 * NGSW can wedge a client on a stale app shell (e.g. after a noisy deploy): its
 * lazy `/admin/*` chunks then resolve to dead paths, Cloudflare Pages answers the
 * missing `.js` with `index.html` as `text/html`, and the browser refuses to run
 * it ("disallowed MIME type"). This service lives at the application root (always
 * alive, independent of route/auth — unlike the old `AppShellComponent` wiring) and
 * recovers automatically:
 *
 * - `VERSION_READY`  → offer a "new version available — Reload" toast (normal path).
 * - `unrecoverable`  → the SW cache is corrupt; hard-reload once to reinitialize it.
 * - a failed lazy-chunk load (router error or a global rejection) → hard-reload once
 *   onto the fresh shell.
 *
 * All forced reloads share one `sessionStorage` guard so we can never loop.
 */
@Injectable({ providedIn: 'root' })
export class SwRecoveryService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Wired from an app initializer so it runs once at startup. */
  init(): void {
    // A global net for failed dynamic imports that surface outside the router
    // (e.g. a WA component or a deferred import). Runs even when the SW is off,
    // since a stale CDN/browser cache can strand a non-SW client too.
    const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
      const reason =
        'reason' in e ? e.reason : (e as ErrorEvent).error ?? (e as ErrorEvent).message;
      if (isChunkLoadError(reason)) {
        this.recoverFromChunkError();
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
    });

    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        this.toast.action(
          $localize`A new version is available.`,
          $localize`Reload`,
          () => document.location.reload(),
        );
      });

    this.swUpdate.unrecoverable.subscribe(() => {
      this.toast.error($localize`Refreshing to recover the app…`);
      this.reloadOnce();
    });
  }

  /**
   * Recover from a failed lazy-chunk load (router navigation error or a global
   * rejection): one guarded reload onto the fresh shell.
   */
  recoverFromChunkError(): void {
    this.reloadOnce();
  }

  /** Force-reload at most once per tab, so recovery can never become a reload loop. */
  private reloadOnce(): void {
    if (typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY)) {
        return;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    }
    document.location.reload();
  }
}

/** True when `err` looks like a failed lazy-chunk / dynamic-import load. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const text =
    typeof err === 'string'
      ? err
      : `${(err as { name?: string }).name ?? ''} ${(err as { message?: string }).message ?? ''}`;
  return CHUNK_ERROR_PATTERNS.some((p) => text.includes(p));
}
