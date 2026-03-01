import { describe, expect, it } from 'vitest';
import { createSigner } from '../src/signer/interface.js';

const SECRET = 'test-secret-key-2026';

function makeSigner(secret = SECRET) {
  return createSigner({ algorithm: 'hmac-sha256', secret });
}

describe('createSigner (hmac-sha256)', () => {
  it('sign() returns a prefixed string "hmac-sha256:..."', () => {
    const signer = makeSigner();
    const sig = signer.sign('hello');
    expect(sig.startsWith('hmac-sha256:')).toBe(true);
    expect(sig.length).toBeGreaterThan('hmac-sha256:'.length);
  });

  it('verify() returns true for a valid signature', () => {
    const signer = makeSigner();
    const sig = signer.sign('hello');
    expect(signer.verify('hello', sig)).toBe(true);
  });

  it('verify() returns false for tampered data', () => {
    const signer = makeSigner();
    const sig = signer.sign('hello');
    expect(signer.verify('hello!', sig)).toBe(false);
  });

  it('verify() returns false for tampered signature', () => {
    const signer = makeSigner();
    const sig = signer.sign('hello');
    // Flip the last hex char
    const last = sig.at(-1)!;
    const flipped = last === '0' ? '1' : '0';
    const tampered = sig.slice(0, -1) + flipped;
    expect(signer.verify('hello', tampered)).toBe(false);
  });

  it('verify() returns false for wrong prefix (e.g. "ed25519:...")', () => {
    const signer = makeSigner();
    const sig = signer.sign('hello');
    const wrongPrefix = sig.replace('hmac-sha256:', 'ed25519:');
    expect(signer.verify('hello', wrongPrefix)).toBe(false);
  });

  it('verify() returns false for malformed signature (no colon)', () => {
    const signer = makeSigner();
    expect(signer.verify('hello', 'nocolonhere')).toBe(false);
  });

  it('different secrets produce different signatures', () => {
    const signer1 = makeSigner('secret-a');
    const signer2 = makeSigner('secret-b');
    const sig1 = signer1.sign('same-data');
    const sig2 = signer2.sign('same-data');
    expect(sig1).not.toBe(sig2);
  });

  it('sign() is deterministic (same input produces same output)', () => {
    const signer = makeSigner();
    const sig1 = signer.sign('deterministic');
    const sig2 = signer.sign('deterministic');
    expect(sig1).toBe(sig2);
  });

  it('empty string data works correctly', () => {
    const signer = makeSigner();
    const sig = signer.sign('');
    expect(sig.startsWith('hmac-sha256:')).toBe(true);
    expect(signer.verify('', sig)).toBe(true);
    expect(signer.verify('non-empty', sig)).toBe(false);
  });
});
