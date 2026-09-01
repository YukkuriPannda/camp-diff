import * as crypto from 'node:crypto';
import { SharedPresenceState } from '../types';
import { isSharedPresenceState } from './presenceProtocol';

const MESSAGE_KIND = 'camp-diff-presence-v1';
const derivedKeys = new Map<string, Buffer>();

interface ClearPayload {
  encrypted: false;
  state: SharedPresenceState | null;
}

interface EncryptedPayload {
  encrypted: true;
  iv: string;
  ciphertext: string;
  authTag: string;
}

interface RelayData {
  kind: typeof MESSAGE_KIND;
  senderId: string;
  payload: ClearPayload | EncryptedPayload;
}

export interface RelayPresenceMessage {
  type: 'publish';
  topic: string;
  data: RelayData;
}

export interface DecodedRelayPresence {
  senderId: string;
  state: SharedPresenceState | null;
}

function deriveKey(roomName: string, password: string): Buffer {
  const cacheKey = `${roomName}\0${password}`;
  let key = derivedKeys.get(cacheKey);
  if (!key) {
    key = crypto.scryptSync(password, `camp-diff:${roomName}`, 32);
    derivedKeys.set(cacheKey, key);
  }
  return key;
}

export function createRelayPresenceMessage(
  topic: string,
  senderId: string,
  state: SharedPresenceState | null,
  password: string | undefined,
): RelayPresenceMessage {
  let payload: ClearPayload | EncryptedPayload;
  if (!password) {
    payload = { encrypted: false, state };
  } else {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(topic, password), iv);
    cipher.setAAD(Buffer.from(`${topic}\0${senderId}`, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state), 'utf8'),
      cipher.final(),
    ]);
    payload = {
      encrypted: true,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }
  return { type: 'publish', topic, data: { kind: MESSAGE_KIND, senderId, payload } };
}

export function decodeRelayPresenceMessage(
  value: unknown,
  topic: string,
  password: string | undefined,
): DecodedRelayPresence | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  if (message.type !== 'publish' || message.topic !== topic || !message.data || typeof message.data !== 'object') {
    return undefined;
  }
  const data = message.data as Record<string, unknown>;
  if (data.kind !== MESSAGE_KIND || typeof data.senderId !== 'string' || !data.payload || typeof data.payload !== 'object') {
    return undefined;
  }
  const payload = data.payload as Record<string, unknown>;
  let state: unknown;
  if (payload.encrypted === false) {
    if (password) {
      return undefined;
    }
    state = payload.state;
  } else if (
    payload.encrypted === true &&
    password &&
    typeof payload.iv === 'string' &&
    typeof payload.ciphertext === 'string' &&
    typeof payload.authTag === 'string'
  ) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveKey(topic, password),
        Buffer.from(payload.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(`${topic}\0${data.senderId}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      state = JSON.parse(plaintext) as unknown;
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (state !== null && !isSharedPresenceState(state)) {
    return undefined;
  }
  return { senderId: data.senderId, state };
}
