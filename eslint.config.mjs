export default [
  {
    ignores: [
      '**/node_modules/**',
      '.agents/skills/**',
      '**/vendor/**',
      '**/*.min.js',
      '**/dist/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
    },
    rules: {
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'valid-typeof': 'error',
    },
  },
];
