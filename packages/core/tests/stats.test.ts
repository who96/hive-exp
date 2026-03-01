import { describe, expect, it } from 'vitest';

import { computeDecay, effectiveConfidence } from '../src/stats/decay.js';

describe('computeDecay', () => {
  it('no decay when 0 days elapsed', () => {
    const now = '2026-03-01T10:00:00Z';
    const result = computeDecay(0.8, now, now, 30);
    expect(result).toBe(0.8);
  });

  it('half confidence after exactly 1 half-life (30 days)', () => {
    const lastConfirmed = '2026-03-01T00:00:00Z';
    const now = '2026-03-31T00:00:00Z';
    const result = computeDecay(1.0, lastConfirmed, now, 30);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('quarter confidence after 2 half-lives (60 days)', () => {
    const lastConfirmed = '2026-01-01T00:00:00Z';
    const now = '2026-03-02T00:00:00Z';
    const result = computeDecay(1.0, lastConfirmed, now, 30);
    expect(result).toBeCloseTo(0.25, 5);
  });

  it('near-zero after many half-lives', () => {
    const lastConfirmed = '2020-01-01T00:00:00Z';
    const now = '2026-01-01T00:00:00Z';
    const result = computeDecay(1.0, lastConfirmed, now, 30);
    expect(result).toBeLessThan(0.001);
  });

  it('negative days elapsed returns original confidence', () => {
    const lastConfirmed = '2026-03-10T00:00:00Z';
    const now = '2026-03-01T00:00:00Z';
    const result = computeDecay(0.8, lastConfirmed, now, 30);
    expect(result).toBe(0.8);
  });

  it('custom half-life (7 days)', () => {
    const lastConfirmed = '2026-03-01T00:00:00Z';
    const now = '2026-03-08T00:00:00Z';
    const result = computeDecay(1.0, lastConfirmed, now, 7);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('clamps result to 0-1 range', () => {
    const result = computeDecay(1.0, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z', 30);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('accepts Date objects', () => {
    const lastConfirmed = new Date('2026-03-01T00:00:00Z');
    const now = new Date('2026-03-31T00:00:00Z');
    const result = computeDecay(1.0, lastConfirmed, now, 30);
    expect(result).toBeCloseTo(0.5, 5);
  });
});

describe('effectiveConfidence', () => {
  it('returns current decayed value', () => {
    // Use a date far in the past so we can verify decay happened
    const lastConfirmed = '2020-01-01T00:00:00Z';
    const result = effectiveConfidence(1.0, lastConfirmed, 30);
    expect(result).toBeLessThan(0.01);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('returns original confidence for very recent date', () => {
    const now = new Date().toISOString();
    const result = effectiveConfidence(0.9, now, 30);
    // Should be very close to 0.9 since almost no time has passed
    expect(result).toBeCloseTo(0.9, 1);
  });

  it('uses default half-life of 30 days', () => {
    const lastConfirmed = '2020-01-01T00:00:00Z';
    const withDefault = effectiveConfidence(1.0, lastConfirmed);
    const withExplicit = effectiveConfidence(1.0, lastConfirmed, 30);
    expect(withDefault).toBeCloseTo(withExplicit, 10);
  });
});
