import ignore from 'ignore';

export function createIgnoreMatcher(patterns: string[]): (relativePosixPath: string) => boolean {
  const matcher = ignore().add(patterns);
  return (relativePosixPath) => matcher.ignores(relativePosixPath);
}
