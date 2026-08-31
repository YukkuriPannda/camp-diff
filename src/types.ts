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
