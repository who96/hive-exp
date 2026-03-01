import type { SignerInterface } from '../types/index.js';
import { HmacSha256Signer } from './hmac.js';

export type { SignerInterface };

export function createSigner(config: {
  algorithm: 'hmac-sha256';
  secret: string;
}): SignerInterface {
  switch (config.algorithm) {
    case 'hmac-sha256':
      return new HmacSha256Signer(config.secret);
    default: {
      const _exhaustive: never = config.algorithm;
      throw new Error(`Unsupported algorithm: ${_exhaustive}`);
    }
  }
}
