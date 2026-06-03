import { Route } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { LandingComponent } from './pages/landing.component';
import { JoinComponent } from './pages/join.component';
import { AppShellComponent } from './components/app-shell.component';

export const appRoutes: Route[] = [
  { path: '', component: LandingComponent, pathMatch: 'full' },
  { path: 'join', component: JoinComponent, pathMatch: 'full' },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./pages/review.component').then((m) => m.ReviewComponent),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./pages/admin.component').then((m) => m.AdminComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
