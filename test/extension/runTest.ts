import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import { execFile, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { runTests } from '@vscode/test-electron';
import { computeRoomKey } from '../../src/git/roomKey';

const SIGNALING_PORT = 14444;
const TEST_REMOTE_URL = 'https://example.com/camp-diff/integration-fixture.git';
const TEST_BRANCH = 'main';
const FAKE_PEER_ID = 'fake-peer-integration-test';
const FAKE_PEER_USERNAME = 'FakePeer';
const execFileAsync = promisify(execFile);

function findVsCodeExecutable(): string | undefined {
  if (process.env.CAMP_DIFF_VSCODE_EXECUTABLE) {
    return process.env.CAMP_DIFF_VSCODE_EXECUTABLE;
  }
  if (process.platform !== 'win32') {
    return undefined;
  }
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.resolve(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.PROGRAMFILES && path.resolve(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

function waitForStdout(child: ChildProcess, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(marker)) {
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`process exited early with code ${code} before printing "${marker}"`));
      }
    });
  });
}

async function startSignalingServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', path.resolve(__dirname, '../../../signaling-server/src/server.ts')],
    {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(SIGNALING_PORT) },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  await waitForStdout(child, 'listening');
  return child;
}

async function startFakePeer(
  signalingUrl: string,
  roomName: string,
  statusFilePath: string,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      path.resolve(__dirname, 'fakePeer.js'),
      signalingUrl,
      roomName,
      statusFilePath,
      FAKE_PEER_ID,
      FAKE_PEER_USERNAME,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await waitForStdout(child, 'fake peer ready');
  return child;
}

async function createTestWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'camp-diff-integration-'));
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  await execFileAsync('git', ['init'], { cwd: dir, env: gitEnv });
  await execFileAsync('git', ['checkout', '-b', TEST_BRANCH], { cwd: dir, env: gitEnv });
  await execFileAsync('git', ['remote', 'add', 'origin', TEST_REMOTE_URL], { cwd: dir, env: gitEnv });
  await fs.writeFile(
    path.join(dir, 'sample.ts'),
    Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n',
    'utf8',
  );
  return dir;
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, 'index.js');
  const signalingUrl = `ws://127.0.0.1:${SIGNALING_PORT}`;
  const vscodeExecutablePath = findVsCodeExecutable();

  const signalingServer = await startSignalingServer();
  const workspacePath = await createTestWorkspace();
  const roomName = computeRoomKey(TEST_REMOTE_URL, TEST_BRANCH);
  if (!roomName) {
    throw new Error('failed to derive the integration test room key');
  }
  const statusFilePath = path.join(workspacePath, '.fake-peer-status.json');
  await fs.writeFile(statusFilePath, '[]', 'utf8');
  const fakePeer = await startFakePeer(signalingUrl, roomName, statusFilePath);

  try {
    const exitCode = await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      launchArgs: [
        workspacePath,
        '--disable-gpu',
        '--disable-workspace-trust',
        '--skip-release-notes',
        '--skip-welcome',
      ],
      extensionTestsEnv: {
        CAMP_DIFF_TEST_SIGNALING_URL: signalingUrl,
        CAMP_DIFF_TEST_FAKE_PEER_ID: FAKE_PEER_ID,
        CAMP_DIFF_TEST_FAKE_PEER_USERNAME: FAKE_PEER_USERNAME,
        CAMP_DIFF_TEST_STATUS_FILE: statusFilePath,
      },
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    fakePeer.kill();
    signalingServer.kill();
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
