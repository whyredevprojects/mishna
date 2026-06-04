import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { AuthService } from '../services/auth.service';
import { meQueryOptions } from '../queries/queries';

/**
 * Gates the admin routes: loads `GET /api/me` and allows only when `isAdmin`,
 * else redirects to the dashboard. The server's `requireAdmin` is the real
 * authorization boundary; this is purely a UX redirect.
 *
 * Shares the cached `me` with `authGuard`, so entering an admin route resolves
 * from cache rather than issuing a second `/api/me`.
 */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const queryClient = inject(QueryClient);

  const me = await queryClient.ensureQueryData(meQueryOptions(auth));
  return me?.isAdmin === true ? true : router.createUrlTree(['/dashboard']);
};
