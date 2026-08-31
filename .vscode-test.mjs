import { defineConfig } from '@vscode/test-cli';

const vscodeExecutablePath = process.env.CAMP_DIFF_VSCODE_EXECUTABLE;

export default defineConfig({
  files: 'out/test/**/*.test.js',
  ...(vscodeExecutablePath
    ? { useInstallation: { fromPath: vscodeExecutablePath } }
    : {}),
  launchArgs: [
    '--disable-extensions',
    '--disable-gpu',
    '--skip-release-notes',
    '--skip-welcome',
  ],
  mocha: {
    timeout: 10_000,
  },
});
