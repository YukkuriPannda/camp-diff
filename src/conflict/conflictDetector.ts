import { ConflictInfo, FileRange, Member } from '../types';

function getLineGap(rangeA: FileRange, rangeB: FileRange): number {
  const earlier = rangeA.startLine <= rangeB.startLine ? rangeA : rangeB;
  const later = earlier === rangeA ? rangeB : rangeA;

  return Math.max(0, later.startLine - earlier.endLine);
}

function rangesConflict(rangeA: FileRange, rangeB: FileRange, proximityLines: number): boolean {
  return getLineGap(rangeA, rangeB) <= proximityLines;
}

export function detectConflicts(members: Member[], proximityLines: number): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];

  for (let memberAIndex = 0; memberAIndex < members.length; memberAIndex += 1) {
    const memberA = members[memberAIndex];

    for (let memberBIndex = memberAIndex + 1; memberBIndex < members.length; memberBIndex += 1) {
      const memberB = members[memberBIndex];
      if (memberA.id === memberB.id) {
        continue;
      }

      for (const rangeA of memberA.files) {
        for (const rangeB of memberB.files) {
          if (rangeA.filePath !== rangeB.filePath || !rangesConflict(rangeA, rangeB, proximityLines)) {
            continue;
          }

          conflicts.push({
            filePath: rangeA.filePath,
            memberA,
            rangeA,
            memberB,
            rangeB,
          });
        }
      }
    }
  }

  return conflicts;
}
