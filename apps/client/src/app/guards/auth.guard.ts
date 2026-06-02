import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Gates the authenticated routes: confirms a session via `GET /api/me` and
 * redirects to the landing page when there isn't one. The server API is the
 * real authorization boundary; this is purely a UX redirect.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth
    .authenticated()
    .pipe(map((ok) => ok || router.createUrlTree(['/'])));
};
