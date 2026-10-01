import {
  createCipheriv,
  createECDH,
  createHmac,
  randomBytes,
  sign,
} from 'node:crypto';
import type { VapidConfig } from './push-config';

export type StoredPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
};

export type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
};

type EncryptionOptions = {
  senderPrivateKey?: Buffer;
  salt?: Buffer;
  recordSize?: number;
};

function hmac(key: Buffer, value: Buffer) {
  return createHmac('sha256', key).update(value).digest();
}

function expand(prk: Buffer, info: Buffer, length: number) {
  return hmac(prk, Buffer.concat([info, Buffer.from([0x01])])).subarray(0, length);
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function encryptPushPayload(
  plaintext: Buffer,
  receiverPublicKey: Buffer,
  authSecret: Buffer,
  options: EncryptionOptions = {},
) {
  if (receiverPublicKey.length !== 65 || receiverPublicKey[0] !== 0x04) {
    throw new Error('Push subscription public key must be an uncompressed P-256 point.');
  }
  if (authSecret.length !== 16) {
    throw new Error('Push subscription authentication secret must contain 16 bytes.');
  }
  if (plaintext.length > 3993) throw new Error('Push notification payload is too large.');

  const sender = createECDH('prime256v1');
  if (options.senderPrivateKey) sender.setPrivateKey(options.senderPrivateKey);
  else sender.generateKeys();
  const senderPublicKey = sender.getPublicKey(undefined, 'uncompressed');
  const sharedSecret = sender.computeSecret(receiverPublicKey);
  const salt = options.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error('Push encryption salt must contain 16 bytes.');

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    receiverPublicKey,
    senderPublicKey,
  ]);
  const keyPrk = hmac(authSecret, sharedSecret);
  const ikm = expand(keyPrk, keyInfo, 32);
  const prk = hmac(salt, ikm);
  const contentKey = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12);

  const record = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const recordSize = options.recordSize ?? 4096;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(recordSize);
  const header = Buffer.concat([
    salt,
    size,
    Buffer.from([senderPublicKey.length]),
    senderPublicKey,
  ]);
  return Buffer.concat([header, encrypted]);
}

export function createVapidAuthorization(endpoint: string, config: VapidConfig, now = new Date()) {
  const audience = new URL(endpoint).origin;
  const header = encodeJson({ typ: 'JWT', alg: 'ES256' });
  const claims = encodeJson({
    aud: audience,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  });
  const unsigned = `${header}.${claims}`;
  const signature = Buffer.from(sign('sha256', Buffer.from(unsigned), {
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  })).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${config.publicKey}`;
}

export async function sendWebPush(
  subscription: StoredPushSubscription,
  payload: PushPayload,
  config: VapidConfig,
  fetcher: typeof fetch = fetch,
) {
  const body = encryptPushPayload(
    Buffer.from(JSON.stringify(payload)),
    Buffer.from(subscription.p256dh, 'base64url'),
    Buffer.from(subscription.authSecret, 'base64url'),
  );
  return fetcher(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: createVapidAuthorization(subscription.endpoint, config),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '300',
      Urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
}
