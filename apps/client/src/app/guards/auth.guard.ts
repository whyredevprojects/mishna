import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/auth.service';
import { meQueryOptions } from '../queries/queries';

/**
 * Gates the authenticated routes: confirms a session via `GET /api/me` and
 * redirects to the landing page when there isn't one. The server API is the
 * real authorization boundary; this is purely a UX redirect.
 *
 * Resolves through the query cache (`ensureQueryData`): a fresh `me` is reused and
 * concurrent callers (this guard, `adminGuard`, the dashboard) dedup to one fetch.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const queryClient = inject(QueryClient);

  const me = await queryClient.ensureQueryData(meQueryOptions(auth));
  return me !== null ? true : router.createUrlTree(['/']);
};
