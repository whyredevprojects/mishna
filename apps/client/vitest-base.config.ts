import { defineConfig } from 'vitest/config';

// Angular 22's `@angular/build:unit-test` vitest runner generates an
// `init-testbed` setup file that subclasses `TestComponentRenderer` from
// `@angular/core/testing` (to avoid stale JSDOM document refs in non-isolated
// mode). That setup file and the spec files must resolve to the SAME instance
// of the Angular testing packages, otherwise the environment initialized in the
// setup file is invisible to the specs and TestBed throws
// "Need to call TestBed.initTestEnvironment() first"
// (angular/angular-cli#33216 / #31732).
//
// Forcing the Angular testing entry points to be inlined + deduped keeps them a
// single module instance across the setup file and the spec bundles. This base
// config is merged in via the `runnerConfig` builder option.
export default defineConfig({
  resolve: {
    dedupe: [
      '@angular/core',
      '@angular/core/testing',
      '@angular/common',
      '@angular/common/testing',
      '@angular/platform-browser',
      '@angular/platform-browser/testing',
      '@angular/router',
    ],
  },
  test: {
    server: {
      deps: {
        inline: [/@angular\//],
      },
    },
  },
});
