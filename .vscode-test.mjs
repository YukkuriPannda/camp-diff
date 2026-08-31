import { defineConfig } from '@vscode/test-cli';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function findVsCodeExecutable() {
  if (process.env.CAMP_DIFF_VSCODE_EXECUTABLE) {
    return process.env.CAMP_DIFF_VSCODE_EXECUTABLE;
  }
  if (process.platform !== 'win32') {
    return undefined;
  }
  const candidates = [
    process.env.LOCALAPPDATA &&
      resolve(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const vscodeExecutablePath = findVsCodeExecutable();

export default defineConfig({
  files: 'out/test/**/*.test.js',
  useInstallation: vscodeExecutablePath ? { fromPath: vscodeExecutablePath } : undefined,
  launchArgs: [
    '--disable-extensions',
    '--disable-gpu',
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
  ],
  mocha: {
    timeout: 10_000,
  },
});
