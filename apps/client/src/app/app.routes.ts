import { Route } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';
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
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/admin.component').then((m) => m.AdminComponent),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin-groups.component').then(
                (m) => m.AdminGroupsComponent,
              ),
          },
          {
            path: 'users',
            loadComponent: () =>
              import('./pages/admin-users.component').then(
                (m) => m.AdminUsersComponent,
              ),
          },
          {
            path: 'users/:id',
            loadComponent: () =>
              import('./pages/admin-user-detail.component').then(
                (m) => m.AdminUserDetailComponent,
              ),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
