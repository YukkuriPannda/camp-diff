import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as config from '../config';

const execFileAsync = promisify(execFile);

async function resolveGitUserName(cwd: string): Promise<string | undefined> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      return undefined;
    }
    const gitApi = (await gitExtension.activate()).getAPI(1);
    const { stdout } = await execFileAsync(gitApi.git.path, ['config', 'user.name'], { cwd });
    const name = stdout.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function getOsUsername(): string | undefined {
  try {
    const name = os.userInfo().username.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

export class IdentityService {
  async resolveUsername(): Promise<string> {
    const configured = config.getUsername();
    if (configured) {
      return configured;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (cwd) {
      const gitUsername = await resolveGitUserName(cwd);
      if (gitUsername) {
        return gitUsername;
      }
    }

    const osUsername = getOsUsername();
    if (osUsername) {
      return osUsername;
    }

    return this.promptForUsername();
  }

  async promptForUsername(): Promise<string> {
    const entered = await vscode.window.showInputBox({
      prompt: 'camp-diffで表示するユーザー名を入力してください',
      value: config.getUsername() || getOsUsername() || '',
      ignoreFocusOut: true,
    });
    const name = entered?.trim();
    if (!name) {
      return config.getUsername() || getOsUsername() || 'anonymous';
    }
    await config.setUsername(name);
    return name;
  }
}
