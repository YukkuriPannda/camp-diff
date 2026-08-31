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
  awareness.on('change', writeStatus);
  writeStatus();

  awareness.setLocalState({
    presence: {
      id: peerId,
      username: peerUsername,
      files: [peerRange],
      updatedAt: Date.now(),
    },
    heartbeatAt: Date.now(),
  });
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
