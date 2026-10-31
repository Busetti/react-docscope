import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  addons: ['@storybook/addon-docs'],
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  // Sample documents are served from the repository fixtures.
  staticDirs: [{ from: '../../../tests/fixtures', to: '/fixtures' }],
  core: { disableTelemetry: true },
};
export default config;
