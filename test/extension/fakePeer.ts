import * as fs from 'node:fs';
import wrtc from '@roamhq/wrtc';

async function main(): Promise<void> {
  const [, , signalingUrl, roomName, statusFilePath, peerId, peerUsername, peerRangeJson] = process.argv;
  if (!signalingUrl || !roomName || !statusFilePath || !peerId || !peerUsername || !peerRangeJson) {
    throw new Error(
      'usage: fakePeer.js <signalingUrl> <roomName> <statusFilePath> <peerId> <peerUsername> <peerRangeJson>',
    );
  }
  const peerRange = JSON.parse(peerRangeJson) as { filePath: string; startLine: number; endLine: number };
  const otherPeerRange = { filePath: 'peer-other.ts', startLine: 1, endLine: 2 };
  const peerRanges = [peerRange, otherPeerRange];

  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
    const { WebSocket } = await import('ws');
    (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
  }

  const { Doc } = await import('yjs');
  const { Awareness } = await import('y-protocols/awareness');
  const { WebrtcProvider } = await import('y-webrtc');

  const doc = new Doc();
  const awareness = new Awareness(doc);
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: [signalingUrl],
    awareness,
    peerOpts: { wrtc },
  });

  const writeStatus = () => {
    const remoteStates = [...awareness.getStates().entries()]
      .filter(([clientId]) => clientId !== awareness.clientID)
      .map(([, state]) => state);
    fs.writeFileSync(statusFilePath, JSON.stringify(remoteStates), 'utf8');
  };
  let sharedFilePaths = new Set<string>();
  const publishPresence = () => {
    awareness.setLocalState({
      presence: {
        id: peerId,
        username: peerUsername,
        filePaths: peerRanges.map((range) => range.filePath),
        ranges: peerRanges.filter((range) => sharedFilePaths.has(range.filePath)),
        rangeRequests: [],
        updatedAt: Date.now(),
      },
      heartbeatAt: Date.now(),
    });
  };
  const handleAwarenessChange = () => {
    writeStatus();
    const nextSharedFilePaths = new Set<string>();
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID || !state || typeof state !== 'object') {
        continue;
      }
      const presence = (state as Record<string, unknown>).presence as
        | { rangeRequests?: unknown }
        | undefined;
      if (!Array.isArray(presence?.rangeRequests)) {
        continue;
      }
      for (const request of presence.rangeRequests) {
        if (
          request !== null &&
          typeof request === 'object' &&
          (request as { peerId?: unknown }).peerId === peerId &&
          typeof (request as { filePath?: unknown }).filePath === 'string'
        ) {
          nextSharedFilePaths.add((request as { filePath: string }).filePath);
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
  awareness.on('change', handleAwarenessChange);
  writeStatus();
  publishPresence();
  setInterval(() => {
    awareness.setLocalStateField('heartbeatAt', Date.now());
  }, 10_000);

  process.on('SIGTERM', () => {
    provider.destroy();
    awareness.destroy();
    doc.destroy();
    process.exit(0);
  });

  process.stdout.write('fake peer ready\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
