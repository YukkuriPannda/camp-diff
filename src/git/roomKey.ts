import { createHash } from 'node:crypto';

const ROOM_KEY_HEX_LENGTH = 32;
const SHORT_COMMIT_LENGTH = 7;

/**
 * Git remote URLs of the common URL and SCP forms are reduced to the same
 * host/path identity. The result intentionally contains no protocol or
 * credentials, so HTTPS and SSH clones of the same repository share a room.
 */
export function normalizeRemoteUrl(remoteUrl: string): string | undefined {
  const value = remoteUrl.trim();
  if (!value) {
    return undefined;
  }

  let repositoryPath: string;
  const scpMatch = /^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/.exec(value);
  if (!value.includes('://') && scpMatch) {
    repositoryPath = `${scpMatch[1]}/${scpMatch[2]}`;
  } else {
    try {
      const parsed = new URL(value.includes('://') ? value : `https://${value}`);
      repositoryPath = `${parsed.host}${parsed.pathname}`;
    } catch {
      return undefined;
    }
  }

  const normalized = repositoryPath
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
  return normalized || undefined;
}

export function resolveBranchIdentifier(
  branchName: string | undefined,
  commitHash: string | undefined,
): string | undefined {
  const branch = branchName?.trim();
  if (branch) {
    return branch;
  }
  const commit = commitHash?.trim();
  return commit ? commit.slice(0, SHORT_COMMIT_LENGTH).toLowerCase() : undefined;
}

export function computeRoomKey(
  remoteUrl: string | undefined,
  branchName: string | undefined,
  commitHash?: string,
): string | undefined {
  if (!remoteUrl) {
    return undefined;
  }
  const normalizedRemote = normalizeRemoteUrl(remoteUrl);
  const branchIdentifier = resolveBranchIdentifier(branchName, commitHash);
  if (!normalizedRemote || !branchIdentifier) {
    return undefined;
  }
  return createHash('sha256')
    .update(`${normalizedRemote}\n${branchIdentifier}`, 'utf8')
    .digest('hex')
    .slice(0, ROOM_KEY_HEX_LENGTH);
}

export function getRepositoryDisplayName(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) {
    return undefined;
  }
  const normalized = normalizeRemoteUrl(remoteUrl);
  if (!normalized) {
    return undefined;
  }
  const parts = normalized.split('/');
  return parts.slice(-2).join('/');
}
