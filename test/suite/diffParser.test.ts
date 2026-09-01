import assert from 'node:assert/strict';
import { parseUnifiedDiffRanges } from '../../src/git/diffParser';

function diff(...lines: string[]): string {
  return lines.join('\n');
}

suite('parseUnifiedDiffRanges', () => {
  test('追加されたハンクを新しい側の行範囲に変換する', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/auth.ts b/src/auth.ts',
        'index 1111111..2222222 100644',
        '--- a/src/auth.ts',
        '+++ b/src/auth.ts',
        '@@ -10,0 +11,3 @@',
        '+const a = 1;',
        '+const b = 2;',
        '+const c = 3;',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/auth.ts', startLine: 11, endLine: 13 }]);
  });

  test('カウントが省略されたハンクを1行として扱う', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -5 +5 @@',
        '-old',
        '+new',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/a.ts', startLine: 5, endLine: 5 }]);
  });

  test('削除だけのハンクは直前の行を指す', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -5,2 +4,0 @@',
        '-gone',
        '-gone too',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/a.ts', startLine: 4, endLine: 4 }]);
  });

  test('先頭行の削除でも1行目より小さくならない', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +0,0 @@',
        '-gone',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/a.ts', startLine: 1, endLine: 1 }]);
  });

  test('隣接するハンクをひとつの範囲にまとめる', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,0 +1,2 @@',
        '+one',
        '+two',
        '@@ -1,0 +3,1 @@',
        '+three',
        '@@ -20,0 +21,1 @@',
        '+far away',
        '',
      ),
    );

    assert.deepEqual(ranges, [
      { filePath: 'src/a.ts', startLine: 1, endLine: 3 },
      { filePath: 'src/a.ts', startLine: 21, endLine: 21 },
    ]);
  });

  test('複数ファイルをパスごとに分けて返す', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -0,0 +1,1 @@',
        '+b',
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -0,0 +7,1 @@',
        '+a',
        '',
      ),
    );

    assert.deepEqual(ranges, [
      { filePath: 'src/a.ts', startLine: 7, endLine: 7 },
      { filePath: 'src/b.ts', startLine: 1, endLine: 1 },
    ]);
  });

  test('削除されたファイルは範囲を持たない', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/gone.ts b/src/gone.ts',
        'deleted file mode 100644',
        '--- a/src/gone.ts',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-one',
        '-two',
        '-three',
        '',
      ),
    );

    assert.deepEqual(ranges, []);
  });

  test('新規ファイルは1行目から数える', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/new.ts', startLine: 1, endLine: 2 }]);
  });

  test('ヘッダーに見えるハンク本文の行を誤ってパスとして読まない', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -0,0 +4,2 @@',
        // The added text itself is `++ b/spoofed.ts`, which git renders with an
        // extra `+` and would otherwise look like a file header.
        '+++ b/spoofed.ts',
        '+@@ -1,1 +99,1 @@',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/a.ts', startLine: 4, endLine: 5 }]);
  });

  test('改行なしマーカーがハンク本文の数え上げを壊さない', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -3 +3 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -0,0 +2,1 @@',
        '+added',
        '',
      ),
    );

    assert.deepEqual(ranges, [
      { filePath: 'src/a.ts', startLine: 3, endLine: 3 },
      { filePath: 'src/b.ts', startLine: 2, endLine: 2 },
    ]);
  });

  test('引用符付きの八進エスケープされたパスを復元する', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git "a/src/\\346\\227\\245\\346\\234\\254.ts" "b/src/\\346\\227\\245\\346\\234\\254.ts"',
        '--- "a/src/\\346\\227\\245\\346\\234\\254.ts"',
        '+++ "b/src/\\346\\227\\245\\346\\234\\254.ts"',
        '@@ -0,0 +1,1 @@',
        '+x',
        '',
      ),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/日本.ts', startLine: 1, endLine: 1 }]);
  });

  test('CRLFで区切られた出力も読める', () => {
    const ranges = parseUnifiedDiffRanges(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -0,0 +2,1 @@',
        '+added',
        '',
      ].join('\r\n'),
    );

    assert.deepEqual(ranges, [{ filePath: 'src/a.ts', startLine: 2, endLine: 2 }]);
  });

  test('モード変更だけのエントリは範囲を持たない', () => {
    const ranges = parseUnifiedDiffRanges(
      diff(
        'diff --git a/script.sh b/script.sh',
        'old mode 100644',
        'new mode 100755',
        '',
      ),
    );

    assert.deepEqual(ranges, []);
  });

  test('空の出力を空配列として返す', () => {
    assert.deepEqual(parseUnifiedDiffRanges(''), []);
  });
});
