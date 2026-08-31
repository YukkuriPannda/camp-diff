import * as path from 'node:path';
import { globSync } from 'node:fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', timeout: 60_000, color: true });
  const testsRoot = path.resolve(__dirname, 'suite');

  for (const file of globSync('**/*.test.js', { cwd: testsRoot })) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
