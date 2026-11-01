/** @type {import('jest').Config} */
const swc = (syntax) => [
  '@swc/jest',
  {
    jsc: {
      parser:
        syntax === 'ts' ? { syntax: 'typescript', tsx: true } : { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'automatic' } },
      target: 'es2022',
    },
    module: { type: 'commonjs' },
  },
];

module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/packages/react-docscope/src', '<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': swc('ts'),
    '^.+\\.(js|jsx|mjs|cjs)$': swc('js'),
  },
  // Most of the unified / micromark ecosystem is ESM-only: transform node_modules
  // except a few large CommonJS packages.
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(react@|react-dom@|scheduler@|@babel|jsdom@|pdfjs-dist@|typescript@|@swc)',
  ],
  moduleNameMapper: {
    // `REACT_VERSION=18 pnpm test` runs the whole suite against React 18.
    ...(process.env.REACT_VERSION === '18'
      ? {
          '^react$': '<rootDir>/node_modules/react-18',
          '^react/(.*)$': '<rootDir>/node_modules/react-18/$1',
          '^react-dom$': '<rootDir>/node_modules/react-dom-18',
          '^react-dom/(.*)$': '<rootDir>/node_modules/react-dom-18/$1',
        }
      : {}),
    '\\.css$': 'identity-obj-proxy',
    '^pdfjs-dist$': '<rootDir>/tests/setup/pdfjs-mock.ts',
    '^pdfjs-dist/(.*)$': '<rootDir>/tests/setup/pdfjs-mock.ts',
    '^(.*)\\?worker&inline$': '<rootDir>/tests/setup/parse-worker-mock.ts',
    '^virtual:pdf-worker-source$': '<rootDir>/tests/setup/pdf-worker-source-mock.ts',
  },
  collectCoverageFrom: [
    'packages/react-docscope/src/**/*.{ts,tsx}',
    '!packages/react-docscope/src/**/*.test.{ts,tsx}',
    '!packages/react-docscope/src/**/*.d.ts',
    // Three-line worker entry; its handler is covered via protocol.ts.
    '!packages/react-docscope/src/**/*.worker.ts',
    '!packages/react-docscope/src/**/__fixtures__/**',
  ],
  coverageReporters: ['text-summary', 'text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 95, branches: 90, functions: 95, lines: 97 },
  },
  testTimeout: 15000,
};
