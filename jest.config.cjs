/** @type {import('jest').Config} */
const swc = (syntax) => [
  '@swc/jest',
  {
    jsc: {
      parser: syntax === 'ts' ? { syntax: 'typescript', tsx: true } : { syntax: 'ecmascript', jsx: true },
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
  transformIgnorePatterns: ['/node_modules/\\.pnpm/(react@|react-dom@|scheduler@|@babel|jsdom@|pdfjs-dist@|typescript@|@swc)'],
  moduleNameMapper: {
    '\\.css$': 'identity-obj-proxy',
    '^pdfjs-dist$': '<rootDir>/tests/setup/pdfjs-mock.ts',
    '^pdfjs-dist/(.*)$': '<rootDir>/tests/setup/pdfjs-mock.ts',
    '^virtual:pdf-worker-source$': '<rootDir>/tests/setup/pdf-worker-source-mock.ts',
  },
  collectCoverageFrom: [
    'packages/react-docscope/src/**/*.{ts,tsx}',
    '!packages/react-docscope/src/**/*.test.{ts,tsx}',
    '!packages/react-docscope/src/**/*.d.ts',
    '!packages/react-docscope/src/**/__fixtures__/**',
  ],
  coverageReporters: ['text-summary', 'text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
  testTimeout: 15000,
};
