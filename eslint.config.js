// Minimal config aimed at one job: catching references to things that do not
// exist. A missing constant is not a syntax error, so `vite build` reports
// success and the app throws at runtime instead.
export default [
  {
    files: ['src/**/*.js', 'src/**/*.jsx', 'netlify/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window:'readonly', document:'readonly', console:'readonly',
        fetch:'readonly', localStorage:'readonly', btoa:'readonly', atob:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly',
        FileReader:'readonly', Blob:'readonly', URL:'readonly', Response:'readonly',
        Request:'readonly', TextDecoder:'readonly', Uint8Array:'readonly',
        process:'readonly', navigator:'readonly', alert:'readonly', confirm:'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
    },
  },
];
