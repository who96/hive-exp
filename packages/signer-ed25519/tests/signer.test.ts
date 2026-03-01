import { createEd25519Signer, createEd25519SignerFromHex, type Ed25519SignerOptions } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

describe('Ed25519 signer', () => {
  it('Creates signer with auto-generated keypair', () => {
    const signer = createEd25519Signer();
    expect(signer).toBeDefined();
    const pub = signer.getPublicKey();
    expect(pub).toBeTypeOf('string');
    expect(pub.length).toBeGreaterThan(0);
  });

  it('sign() returns string starting with "ed25519:"', () => {
    const signer = createEd25519Signer();
    const signature = signer.sign('hello');
    expect(signature.startsWith('ed25519:')).toBe(true);
    expect(signature.length).toBeGreaterThan('ed25519:'.length);
  });

  it('verify() returns true for valid signature', () => {
    const signer = createEd25519Signer();
    const data = 'valid payload';
    const signature = signer.sign(data);
    expect(signer.verify(data, signature)).toBe(true);
  });

  it('verify() returns false for tampered data', () => {
    const signer = createEd25519Signer();
    const data = 'original';
    const signature = signer.sign(data);
    expect(signer.verify('modified', signature)).toBe(false);
  });

  it('verify() returns false for tampered signature', () => {
    const signer = createEd25519Signer();
    const data = 'tamper-me';
    const signature = signer.sign(data);
    // Flip a byte in the middle of the raw signature bytes, then re-encode
    const raw = Buffer.from(signature.slice('ed25519:'.length), 'base64');
    raw[raw.length >> 1] ^= 0xff;
    const bad = `ed25519:${raw.toString('base64')}`;
    expect(signer.verify(data, bad)).toBe(false);
  });

  it('verify() returns false for wrong prefix', () => {
    const signer = createEd25519Signer();
    const data = 'prefix-test';
    const signature = signer.sign(data);
    expect(signer.verify(data, `wrong:${signature.slice(8)}`)).toBe(false);
  });

  it('Different data produces different signatures', () => {
    const signer = createEd25519Signer();
    const sig1 = signer.sign('data-one');
    const sig2 = signer.sign('data-two');
    expect(sig1).not.toBe(sig2);
  });

  it('Same data produces same signature (deterministic)', () => {
    const signer = createEd25519Signer();
    const sig1 = signer.sign('same-data');
    const sig2 = signer.sign('same-data');
    expect(sig1).toBe(sig2);
  });

  it('getPublicKey() returns hex string', () => {
    const signer = createEd25519Signer();
    const publicKey = signer.getPublicKey();
    expect(typeof publicKey).toBe('string');
    expect(publicKey).toMatch(/^[0-9a-f]+$/);
    expect(publicKey.length % 2).toBe(0);
  });

  it('createEd25519SignerFromHex() roundtrips correctly', () => {
    const original = createEd25519Signer();
    const privateKeyHex = original.getPrivateKey();
    const restored = createEd25519SignerFromHex(privateKeyHex);
    const data = 'roundtrip';
    const sig = original.sign(data);
    expect(restored.verify(data, sig)).toBe(true);
    expect(restored.getPublicKey()).toBe(original.getPublicKey());
  });

  it('Two different signers produce different signatures', () => {
    const signer1 = createEd25519Signer();
    const signer2 = createEd25519Signer();
    const data = 'collision-test';
    const sig1 = signer1.sign(data);
    const sig2 = signer2.sign(data);
    expect(sig1).not.toBe(sig2);
  });

  it('Can verify with public-key-only signer (传入 publicKey 选项，sign 抛出错误，verify 工作正常)', () => {
    const pair = generateKeyPairSync('ed25519');
    const signerWithPrivate = createEd25519Signer({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    } as Ed25519SignerOptions);

    const data = 'public-only';
    const signature = signerWithPrivate.sign(data);

    const publicSigner = createEd25519Signer({
      publicKey: pair.publicKey,
    } as Ed25519SignerOptions);

    expect(publicSigner.verify(data, signature)).toBe(true);
    expect(() => publicSigner.sign(data)).toThrow('Cannot sign without private key');
  });
});
