import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import WebSocket from 'ws';
import { SharedPresenceState } from '../../src/types';
import {
  createRelayPresenceMessage,
  decodeRelayPresenceMessage,
} from '../../src/net/relayProtocol';

async function main(): Promise<void> {
  const [, , signalingUrl, roomName, statusFilePath, peerId, peerUsername, peerRangeJson] =
    process.argv;
  if (!signalingUrl || !roomName || !statusFilePath || !peerId || !peerUsername || !peerRangeJson) {
    throw new Error(
      'usage: fakePeer.js <signalingUrl> <roomName> <statusFilePath> <peerId> <peerUsername> <peerRangeJson>',
    );
  }
  const peerRange = JSON.parse(peerRangeJson) as {
    filePath: string;
    startLine: number;
    endLine: number;
  };
  const peerRanges = [peerRange, { filePath: 'peer-other.ts', startLine: 1, endLine: 2 }];
  const senderId = crypto.randomUUID();
  const remoteStates = new Map<string, SharedPresenceState>();
  let sharedFilePaths = new Set<string>();
  const socket = new WebSocket(signalingUrl);

  const writeStatus = () => {
    fs.writeFileSync(
      statusFilePath,
      JSON.stringify([...remoteStates.values()].map((presence) => ({ presence }))),
      'utf8',
    );
  };
  const publishPresence = () => {
    const state: SharedPresenceState = {
      id: peerId,
      username: peerUsername,
      filePaths: peerRanges.map((range) => range.filePath),
      ranges: peerRanges.filter((range) => sharedFilePaths.has(range.filePath)),
      rangeRequests: [],
      updatedAt: Date.now(),
    };
    socket.send(JSON.stringify(createRelayPresenceMessage(roomName, senderId, state, undefined)));
  };
  const recomputeSharedFiles = () => {
    const nextSharedFilePaths = new Set<string>();
    for (const state of remoteStates.values()) {
      for (const request of state.rangeRequests) {
        if (request.peerId === peerId) {
          nextSharedFilePaths.add(request.filePath);
        }
      }
    }
    const changed =
      nextSharedFilePaths.size !== sharedFilePaths.size ||
      [...nextSharedFilePaths].some((filePath) => !sharedFilePaths.has(filePath));
    if (changed) {
      sharedFilePaths = nextSharedFilePaths;
      publishPresence();
    }
  };

  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe', topics: [roomName] }));
    publishPresence();
    process.stdout.write('fake peer ready\n');
  });
  socket.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString()) as unknown;
    } catch {
      return;
    }
    const decoded = decodeRelayPresenceMessage(parsed, roomName, undefined);
    if (!decoded || decoded.senderId === senderId) {
      return;
    }
    if (decoded.state === null) {
      remoteStates.delete(decoded.senderId);
    } else {
      remoteStates.set(decoded.senderId, decoded.state);
    }
    writeStatus();
    recomputeSharedFiles();
  });
  socket.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  const heartbeat = setInterval(publishPresence, 10_000);
  process.on('SIGTERM', () => {
    clearInterval(heartbeat);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify(createRelayPresenceMessage(roomName, senderId, null, undefined)),
      );
    }
    socket.close();
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
