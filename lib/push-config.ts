import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type VapidConfig = {
  privateKey: KeyObject;
  privateJwk: JsonWebKey;
  publicKey: string;
  subject: string;
};

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

export function readVapidConfig(
  environment: Record<string, string | undefined> = process.env,
): VapidConfig {
  if (environment.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_PRIVATE_KEY must not be stored in the environment; use VAPID_PRIVATE_KEY_FILE.');
  }
  const path = environment.VAPID_PRIVATE_KEY_FILE;
  if (!path) throw new Error('VAPID_PRIVATE_KEY_FILE is required.');
  const subject = environment.VAPID_SUBJECT?.trim();
  if (!subject || !/^(mailto:|https:\/\/)/i.test(subject)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https:// contact URI.');
  }

  const privateKey = createPrivateKey(readFileSync(path, 'utf8'));
  const privateJwk = privateKey.export({ format: 'jwk' });
  if (
    privateJwk.kty !== 'EC'
    || privateJwk.crv !== 'P-256'
    || !privateJwk.d
    || !privateJwk.x
    || !privateJwk.y
  ) {
    throw new Error('VAPID private key must be a P-256 EC private key.');
  }
  const publicBytes = Buffer.concat([
    Buffer.from([0x04]),
    decodeBase64Url(privateJwk.x),
    decodeBase64Url(privateJwk.y),
  ]);
  if (publicBytes.length !== 65) throw new Error('VAPID public key is invalid.');
  return {
    privateKey,
    privateJwk,
    publicKey: publicBytes.toString('base64url'),
    subject,
  };
}
