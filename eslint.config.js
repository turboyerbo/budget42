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
        indexedDB:'readonly', createImageBitmap:'readonly', File:'readonly',
        __BUILD_ID__:'readonly', __APP_VERSION__:'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // Catches temporal-dead-zone bugs: using a const/let above the line that
      // declares it. `no-undef` cannot see these because the name does exist,
      // just not yet. They only surface as a white screen at runtime.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
    },
  },
];
