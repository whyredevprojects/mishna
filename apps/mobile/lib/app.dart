import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/auth/auth_controller.dart';
import 'router.dart';

/// Root widget: theme + router, with a splash while the stored session is
/// validated (so a signed-in user never flashes the sign-in screen).
class ChevrasMishnayosApp extends ConsumerWidget {
  const ChevrasMishnayosApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF8A5A2B)),
      useMaterial3: true,
    );

    final auth = ref.watch(authControllerProvider);
    if (auth.isLoading && !auth.hasValue) {
      return MaterialApp(
        title: 'Chevras Mishnayos',
        debugShowCheckedModeBanner: false,
        theme: theme,
        home: const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    return MaterialApp.router(
      title: 'Chevras Mishnayos',
      debugShowCheckedModeBanner: false,
      theme: theme,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
