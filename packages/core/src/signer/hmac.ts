import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignerInterface } from '../types/index.js';

const PREFIX = 'hmac-sha256:';

export class HmacSha256Signer implements SignerInterface {
  readonly #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
  }

  sign(data: string): string {
    const digest = createHmac('sha256', this.#secret)
      .update(data)
      .digest('hex');
    return PREFIX + digest;
  }

  verify(data: string, signature: string): boolean {
    if (!signature.startsWith(PREFIX)) {
      return false;
    }

    const expected = this.sign(data);

    if (expected.length !== signature.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  }
}
