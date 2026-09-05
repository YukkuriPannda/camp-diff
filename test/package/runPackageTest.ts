import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createVSIX, listFiles } from '@vscode/vsce';
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron';

const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'dist/extension.js',
  'media/icon.svg',
  'media/icon.png',
];
const FORBIDDEN_PACKAGE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
];

async function assertPackageContents(repoRoot: string): Promise<void> {
  const packaged = new Set((await listFiles({ cwd: repoRoot })).map((file) => file.split(String.fromCharCode(92)).join('/')));
  const missing = REQUIRED_PACKAGE_FILES.filter((file) => !packaged.has(file));
  if (missing.length > 0) {
    throw new Error(`the .vsix is missing runtime assets: ${missing.join(', ')}`);
  }
  const included = FORBIDDEN_PACKAGE_FILES.filter((file) => packaged.has(file));
  if (included.length > 0) {
    throw new Error(`the .vsix includes internal project files: ${included.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camp-diff-package-'));
  const vsixPath = path.join(workDir, 'camp-diff.vsix');
  const extensionsDir = path.join(workDir, 'extensions');
  const userDataDir = path.join(workDir, 'user-data');
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  await assertPackageContents(repoRoot);
  await createVSIX({ cwd: repoRoot, packagePath: vsixPath, allowMissingRepository: true });

  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  await runVSCodeCommand([
    '--install-extension',
    vsixPath,
    '--extensions-dir',
    extensionsDir,
    '--user-data-dir',
    userDataDir,
  ]);

  try {
    const exitCode = await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.resolve(repoRoot, 'test/package/harness'),
      extensionTestsPath: path.resolve(__dirname, 'index.js'),
      launchArgs: [
        '--extensions-dir',
        extensionsDir,
        '--user-data-dir',
        userDataDir,
        '--disable-gpu',
        '--disable-workspace-trust',
        '--skip-release-notes',
        '--skip-welcome',
      ],
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
