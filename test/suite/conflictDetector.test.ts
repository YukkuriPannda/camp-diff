import assert from 'node:assert/strict';
import { detectConflicts } from '../../src/conflict/conflictDetector';
import { FileRange, Member } from '../../src/types';

const PROXIMITY_LINES = 3;

function member(id: string, files: FileRange[]): Member {
  return {
    id,
    username: id,
    isLocal: id === 'You',
    files,
    updatedAt: 0,
  };
}

function range(filePath: string, startLine: number, endLine: number): FileRange {
  return { filePath, startLine, endLine };
}

suite('detectConflicts', () => {
  test('重複する範囲を衝突とみなす', () => {
    const you = member('You', [range('src/auth.ts', 10, 15)]);
    const tanaka = member('Tanaka', [range('src/auth.ts', 12, 18)]);

    assert.deepEqual(detectConflicts([you, tanaka], PROXIMITY_LINES), [
      {
        filePath: 'src/auth.ts',
        memberA: you,
        rangeA: you.files[0],
        memberB: tanaka,
        rangeB: tanaka.files[0],
      },
    ]);
  });

  test('隣接する範囲を衝突とみなす', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 12)]),
      member('Tanaka', [range('src/auth.ts', 13, 15)]),
    ];

    assert.equal(detectConflicts(members, PROXIMITY_LINES).length, 1);
  });

  test('範囲間のギャップが閾値以内なら衝突とみなす', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 12)]),
      member('Tanaka', [range('src/auth.ts', 15, 18)]),
    ];

    assert.equal(detectConflicts(members, PROXIMITY_LINES).length, 1);
  });

  test('範囲間のギャップが閾値ギリギリ外なら衝突とみなさない', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 12)]),
      member('Tanaka', [range('src/auth.ts', 16, 19)]),
    ];

    assert.deepEqual(detectConflicts(members, PROXIMITY_LINES), []);
  });

  test('別ファイルの範囲は衝突とみなさない', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 15)]),
      member('Tanaka', [range('src/session.ts', 10, 15)]),
    ];

    assert.deepEqual(detectConflicts(members, PROXIMITY_LINES), []);
  });

  test('同じメンバー内の範囲同士は比較しない', () => {
    const you = member('You', [
      range('src/auth.ts', 10, 15),
      range('src/auth.ts', 12, 18),
    ]);

    assert.deepEqual(detectConflicts([you], PROXIMITY_LINES), []);
  });

  test('同じIDのメンバーは別要素でも比較しない', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 15)]),
      member('You', [range('src/auth.ts', 12, 18)]),
    ];

    assert.deepEqual(detectConflicts(members, PROXIMITY_LINES), []);
  });

  test('同じメンバーペアを逆順で重複して数えない', () => {
    const members = [
      member('You', [range('src/auth.ts', 10, 15)]),
      member('Tanaka', [range('src/auth.ts', 12, 18)]),
    ];

    assert.equal(detectConflicts(members, PROXIMITY_LINES).length, 1);
  });
});
