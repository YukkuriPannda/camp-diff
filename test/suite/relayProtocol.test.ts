import assert from 'node:assert/strict';
import { SharedPresenceState } from '../../src/types';
import {
  createRelayPresenceMessage,
  decodeRelayPresenceMessage,
} from '../../src/net/relayProtocol';

const state: SharedPresenceState = {
  id: 'alice@workstation:1',
  username: 'Alice',
  filePaths: ['src/private-name.ts'],
  ranges: [{ filePath: 'src/private-name.ts', startLine: 3, endLine: 8 }],
  rangeRequests: [{ peerId: 'bob@workstation:2', filePath: 'src/other.ts' }],
  updatedAt: 123,
};

suite('relayProtocol', () => {
  test('round-trips an unencrypted presence message', () => {
    const message = createRelayPresenceMessage('room', 'sender', state, undefined);
    assert.deepEqual(decodeRelayPresenceMessage(message, 'room', undefined), {
      senderId: 'sender',
      state,
    });
  });

  test('encrypts presence and rejects a different password', () => {
    const message = createRelayPresenceMessage('room', 'sender', state, 'team secret');
    assert.equal(JSON.stringify(message).includes('private-name.ts'), false);
    assert.deepEqual(decodeRelayPresenceMessage(message, 'room', 'team secret'), {
      senderId: 'sender',
      state,
    });
    assert.equal(decodeRelayPresenceMessage(message, 'room', 'wrong secret'), undefined);
    const tamperedSender = structuredClone(message);
    tamperedSender.data.senderId = 'forged-sender';
    assert.equal(decodeRelayPresenceMessage(tamperedSender, 'room', 'team secret'), undefined);
  });

  test('validates the room, payload, and leave marker', () => {
    const leave = createRelayPresenceMessage('room', 'sender', null, 'team secret');
    assert.deepEqual(decodeRelayPresenceMessage(leave, 'room', 'team secret'), {
      senderId: 'sender',
      state: null,
    });
    assert.equal(decodeRelayPresenceMessage(leave, 'different-room', 'team secret'), undefined);
    assert.equal(
      decodeRelayPresenceMessage({ type: 'publish', topic: 'room', data: {} }, 'room', undefined),
      undefined,
    );
  });
});
