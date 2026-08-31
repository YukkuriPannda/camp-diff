export interface FileRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface Member {
  id: string;
  username: string;
  isLocal: boolean;
  files: FileRange[];
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
