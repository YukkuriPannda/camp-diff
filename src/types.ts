export interface FileRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface Member {
  id: string;
  username: string;
  isLocal: boolean;
  filePaths: string[];
  files: FileRange[];
  detailedFilePaths: string[];
  updatedAt: number;
}

export interface ConflictInfo {
  filePath: string;
  memberA: Member;
  rangeA: FileRange;
  memberB: Member;
  rangeB: FileRange;
}

export interface PresenceState {
  id: string;
  username: string;
  files: FileRange[];
  updatedAt: number;
}

export interface RangeRequest {
  peerId: string;
  filePath: string;
}

/**
 * The presence shape sent through the team relay. File names are always visible so the
 * member tree can be populated, while line ranges are added only for files
 * that at least one peer has explicitly expanded.
 */
export interface SharedPresenceState {
  id: string;
  username: string;
  filePaths: string[];
  ranges?: FileRange[];
  rangeRequests: RangeRequest[];
  updatedAt: number;
}
