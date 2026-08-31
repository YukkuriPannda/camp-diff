import { defineConfig } from '@vscode/test-cli';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function findVsCodeExecutable() {
  if (process.env.VSCODE_EXECUTABLE_PATH) {
    return process.env.VSCODE_EXECUTABLE_PATH;
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
  files: 'out/test/suite/**/*.test.js',
  launchArgs: ['--disable-extensions', '--disable-gpu', '--disable-workspace-trust'],
  useInstallation: vscodeExecutablePath ? { fromPath: vscodeExecutablePath } : undefined,
});
