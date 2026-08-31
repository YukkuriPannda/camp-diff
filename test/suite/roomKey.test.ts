import assert from 'node:assert/strict';
import {
  computeRoomKey,
  getRepositoryDisplayName,
  normalizeRemoteUrl,
  resolveBranchIdentifier,
} from '../../src/git/roomKey';

suite('roomKey', () => {
  test('protocol, credentials, .git suffix, and URL case normalize to one repository', () => {
    const https = 'https://oauth2:secret@GitHub.com/Example/App.git';
    const ssh = 'git@github.com:example/app.git';

    assert.equal(normalizeRemoteUrl(https), 'github.com/example/app');
    assert.equal(normalizeRemoteUrl(ssh), 'github.com/example/app');
    assert.equal(computeRoomKey(https, 'main'), computeRoomKey(ssh, 'main'));
    assert.equal(computeRoomKey(https, 'main'), 'd4337a746ffaf76e5e53773c24c619f6');
  });

  test('configured upstream remote lets forks derive the same room while origin does not', () => {
    const forkOrigin = 'https://github.com/alice/app.git';
    const upstream = 'https://github.com/example/app.git';

    assert.notEqual(computeRoomKey(forkOrigin, 'main'), computeRoomKey(upstream, 'main'));
    assert.equal(
      computeRoomKey(upstream, 'main'),
      computeRoomKey('ssh://git@github.com/example/app.git', 'main'),
    );
  });

  test('detached HEAD falls back to a seven-character commit identifier', () => {
    const remote = 'https://github.com/example/app.git';
    const commit = 'ABCDEF1234567890';

    assert.equal(resolveBranchIdentifier(undefined, commit), 'abcdef1');
    assert.equal(computeRoomKey(remote, undefined, commit), computeRoomKey(remote, 'abcdef1'));
  });

  test('branch name remains significant and case-sensitive', () => {
    const remote = 'https://github.com/example/app.git';

    assert.notEqual(computeRoomKey(remote, 'main'), computeRoomKey(remote, 'feature/main'));
    assert.notEqual(computeRoomKey(remote, 'main'), computeRoomKey(remote, 'Main'));
  });

  test('missing remote or HEAD information disables room derivation', () => {
    assert.equal(computeRoomKey(undefined, 'main'), undefined);
    assert.equal(computeRoomKey('', 'main'), undefined);
    assert.equal(computeRoomKey('https://github.com/example/app.git', undefined), undefined);
  });

  test('repository display name uses the final owner and repository segments', () => {
    assert.equal(getRepositoryDisplayName('git@gitlab.com:team/example/app.git'), 'example/app');
  });
});
