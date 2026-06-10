import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/forgot_password_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/auth/sign_up_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/my_mishnayos/my_mishnayos_screen.dart';
import 'features/notifications/notification_service.dart';
import 'features/review/review_screen.dart';
import 'features/settings/settings_screen.dart';

const _publicPaths = {'/sign-in', '/sign-up', '/forgot-password'};

/// App routes: public auth screens, and the four signed-in tabs behind a
/// bottom navigation shell. Auth gating mirrors the web client's guards —
/// UX only; the server API is the real boundary.
final routerProvider = Provider<GoRouter>((ref) {
  // Re-evaluate redirects whenever the session changes (sign-in/out).
  final refresh = ValueNotifier(0);
  ref.listen(authControllerProvider, (_, next) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      if (auth.isLoading) return null; // splash is shown until resolved
      final signedIn = auth.value != null;
      final public = _publicPaths.contains(state.matchedLocation);
      if (!signedIn && !public) return '/sign-in';
      if (signedIn && public) return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (_, _) => const SignInScreen()),
      GoRoute(path: '/sign-up', builder: (_, _) => const SignUpScreen()),
      GoRoute(
        path: '/forgot-password',
        builder: (_, _) => const ForgotPasswordScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _ShellScaffold(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/dashboard',
              builder: (_, _) => const DashboardScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/my-mishnayos',
              builder: (_, _) => const MyMishnayosScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/review',
              builder: (_, _) => const ReviewScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/settings',
              builder: (_, _) => const SettingsScreen(),
            ),
          ]),
        ],
      ),
    ],
  );

  // Tapping a study reminder lands on the screen its payload names.
  ref.read(notificationServiceProvider).onSelectPayload = router.go;

  return router;
});

/// Bottom navigation around the signed-in tabs.
class _ShellScaffold extends StatelessWidget {
  const _ShellScaffold({required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (index) => shell.goBranch(
          index,
          initialLocation: index == shell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.today_outlined),
            selectedIcon: Icon(Icons.today),
            label: 'Today',
          ),
          NavigationDestination(
            icon: Icon(Icons.menu_book_outlined),
            selectedIcon: Icon(Icons.menu_book),
            label: 'My Mishnayos',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_edu_outlined),
            selectedIcon: Icon(Icons.history_edu),
            label: 'Review',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
