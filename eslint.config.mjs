import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/worker-configuration.d.ts',
      '**/.wrangler',
      // Generated Eleventy build output (apps/www) — never lint bundled/minified assets.
      '**/_site',
      '**/.cache',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  {
    // apps/www browser scripts are plain ESM served as static assets (passthrough-copied,
    // never bundled or part of the Nx/Node module graph). Their imports are runtime URLs
    // (e.g. '/photoswipe/...'), which @nx/enforce-module-boundaries can't reason about.
    files: ['apps/www/src/js/**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
