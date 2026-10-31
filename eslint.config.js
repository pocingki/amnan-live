// ESLint flat config (ESM). Tanpa paket tambahan: global didefinisikan di sini.
const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  Headers: 'readonly', Request: 'readonly', Response: 'readonly', FormData: 'readonly', Blob: 'readonly',
  crypto: 'readonly', performance: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  module: 'writable', require: 'readonly', exports: 'writable',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly', fetch: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  FormData: 'readonly', FileReader: 'readonly', Blob: 'readonly', Audio: 'readonly', Image: 'readonly',
  EventSource: 'readonly', AbortController: 'readonly', Intl: 'readonly', Notification: 'readonly',
  MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly', HTMLElement: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly', getComputedStyle: 'readonly', matchMedia: 'readonly',
  atob: 'readonly', btoa: 'readonly', crypto: 'readonly', performance: 'readonly', MediaRecorder: 'readonly',
  addEventListener: 'readonly', removeEventListener: 'readonly', dispatchEvent: 'readonly',
  innerWidth: 'readonly', innerHeight: 'readonly', scrollTo: 'readonly', open: 'readonly', CSS: 'readonly',
  DOMParser: 'readonly', Node: 'readonly', Element: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
  File: 'readonly', DataTransfer: 'readonly', requestIdleCallback: 'readonly', screen: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-const-assign': 'error',
  'no-self-assign': 'error',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-unsafe-finally': 'error',
  'no-sparse-arrays': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['warn', 'smart'],
};

export default [
  { ignores: ['node_modules/**', 'data/**', 'backups/**', 'public/assets/css/tailwind.css'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
    rules,
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browserGlobals },
    rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
    rules,
  },
];
