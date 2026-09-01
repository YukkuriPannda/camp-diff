import { FileRange, RangeRequest, SharedPresenceState } from '../types';

function isFileRange(value: unknown): value is FileRange {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const range = value as Record<string, unknown>;
  return (
    typeof range.filePath === 'string' &&
    Number.isInteger(range.startLine) &&
    Number.isInteger(range.endLine) &&
    Number(range.startLine) >= 1 &&
    Number(range.endLine) >= Number(range.startLine)
  );
}

function isRangeRequest(value: unknown): value is RangeRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    typeof request.peerId === 'string' &&
    request.peerId.length > 0 &&
    typeof request.filePath === 'string' &&
    request.filePath.length > 0
  );
}

export function isSharedPresenceState(value: unknown): value is SharedPresenceState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    typeof state.id === 'string' &&
    state.id.length > 0 &&
    typeof state.username === 'string' &&
    state.username.length > 0 &&
    Array.isArray(state.filePaths) &&
    state.filePaths.every((filePath) => typeof filePath === 'string') &&
    (state.ranges === undefined ||
      (Array.isArray(state.ranges) && state.ranges.every(isFileRange))) &&
    Array.isArray(state.rangeRequests) &&
    state.rangeRequests.every(isRangeRequest) &&
    typeof state.updatedAt === 'number' &&
    Number.isFinite(state.updatedAt)
  );
}
