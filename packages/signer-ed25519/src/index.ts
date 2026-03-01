import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signWithCrypto,
  verify as verifyWithCrypto,
  type KeyObject,
} from 'node:crypto';
import type { SignerInterface } from '@hive-exp/core';

const PREFIX = 'ed25519:';

export interface Ed25519SignerOptions {
  privateKey?: KeyObject;
  publicKey?: KeyObject;
}

export function createEd25519Signer(options: Ed25519SignerOptions = {}): SignerInterface & {
  getPublicKey(): string;
  getPrivateKey(): string;
} {
  let privateKey: KeyObject | undefined;
  let publicKey: KeyObject;

  if (options.privateKey != null || options.publicKey != null) {
    privateKey = options.privateKey;
    if (options.publicKey != null) {
      publicKey = options.publicKey;
    } else if (privateKey != null) {
      publicKey = createPublicKey(privateKey);
    } else {
      throw new Error('At least one of privateKey or publicKey must be provided');
    }
  } else {
    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  return {
    sign(data: string): string {
      if (privateKey == null) {
        throw new Error('Cannot sign without private key');
      }
      const signature = signWithCrypto(null, Buffer.from(data, 'utf8'), privateKey);
      return `${PREFIX}${signature.toString('base64')}`;
    },

    verify(data: string, signature: string): boolean {
      if (!signature.startsWith(PREFIX)) {
        return false;
      }
      try {
        const sig = Buffer.from(signature.slice(PREFIX.length), 'base64');
        return verifyWithCrypto(null, Buffer.from(data, 'utf8'), publicKey, sig);
      } catch {
        return false;
      }
    },

    getPublicKey(): string {
      return publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
    },

    getPrivateKey(): string {
      if (privateKey == null) {
        throw new Error('No private key available');
      }
      return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
    },
  };
}

export function createEd25519SignerFromHex(privateKeyHex: string): ReturnType<typeof createEd25519Signer> {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  return createEd25519Signer({ privateKey, publicKey });
}
