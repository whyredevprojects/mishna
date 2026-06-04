import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Gates the admin routes: loads `GET /api/me` and allows only when `isAdmin`,
 * else redirects to the dashboard. The server's `requireAdmin` is the real
 * authorization boundary; this is purely a UX redirect.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth
    .loadSession()
    .pipe(map((me) => me?.isAdmin === true || router.createUrlTree(['/dashboard'])));
};
