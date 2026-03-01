import { describe, expect, it } from 'vitest';

import { sanitizeSecurity } from '../src/sanitizer/security.js';
import { sanitizePrivacy } from '../src/sanitizer/privacy.js';

// ---------------------------------------------------------------------------
// Security sanitizer
// ---------------------------------------------------------------------------
describe('sanitizeSecurity', () => {
  it('detects and neutralizes eval()', () => {
    const r = sanitizeSecurity('eval("malicious")');
    expect(r.clean).not.toContain('eval(');
    expect(r.violations).toContain('eval() call');
  });

  it('detects exec("rm -rf /")', () => {
    const r = sanitizeSecurity('exec("rm -rf /")');
    expect(r.clean).not.toContain('exec(');
    expect(r.violations).toContain('exec() call');
    expect(r.violations).toContain('rm -rf command');
  });

  it('detects backtick injection', () => {
    const r = sanitizeSecurity('const x = `whoami`');
    expect(r.clean).not.toContain('`whoami`');
    expect(r.violations).toContain('backtick expression');
  });

  it('detects <script> tags', () => {
    const r = sanitizeSecurity('<script>alert("xss")</script>');
    expect(r.clean).not.toContain('<script>');
    expect(r.violations).toContain('<script> tag');
  });

  it('detects SQL injection patterns', () => {
    const r = sanitizeSecurity("'; DROP TABLE users; --");
    expect(r.violations).toContain('SQL DROP TABLE injection');
  });

  it('detects path traversal', () => {
    const r = sanitizeSecurity('../../../etc/passwd');
    expect(r.violations).toContain('path traversal');
    expect(r.violations).toContain('/etc/passwd access');
  });

  it('detects Unicode variant eval (full-width)', () => {
    // U+FF45 U+FF56 U+FF41 U+FF4C = ｅｖａｌ
    const r = sanitizeSecurity('\uff45\uff56\uff41\uff4c("test")');
    expect(r.violations).toContain('eval() call');
  });

  it('detects null bytes', () => {
    const r = sanitizeSecurity('file\0name');
    expect(r.violations).toContain('null byte');
    expect(r.clean).not.toContain('\0');
  });

  it('detects encoded null bytes (%00)', () => {
    const r = sanitizeSecurity('file%00name');
    expect(r.violations).toContain('encoded null byte');
  });

  it('passes safe strings through unchanged', () => {
    const safe = 'Hello, this is a perfectly normal string.';
    const r = sanitizeSecurity(safe);
    expect(r.clean).toBe(safe);
    expect(r.violations).toEqual([]);
  });

  it('detects multiple violations in one string', () => {
    const r = sanitizeSecurity('eval("x"); exec("y"); <script>z</script>');
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
    expect(r.violations).toContain('eval() call');
    expect(r.violations).toContain('exec() call');
    expect(r.violations).toContain('<script> tag');
  });
});

// ---------------------------------------------------------------------------
// Privacy sanitizer
// ---------------------------------------------------------------------------
describe('sanitizePrivacy', () => {
  it('redacts sk-proj-... API keys', () => {
    const r = sanitizePrivacy('key is sk-proj-abc123def456');
    expect(r.clean).toContain('[REDACTED:api_key]');
    expect(r.clean).not.toContain('sk-proj-abc123def456');
    expect(r.redactions).toContain('OpenAI API key');
  });

  it('redacts AWS access keys', () => {
    const r = sanitizePrivacy('aws key AKIAIOSFODNN7EXAMPLE');
    expect(r.clean).toContain('[REDACTED:api_key]');
    expect(r.clean).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(r.redactions).toContain('AWS access key');
  });

  it('redacts GitHub personal tokens (ghp_)', () => {
    const r = sanitizePrivacy('token ghp_xxxxxxxxxxxx');
    expect(r.clean).toContain('[REDACTED:api_key]');
    expect(r.clean).not.toContain('ghp_xxxxxxxxxxxx');
    expect(r.redactions).toContain('GitHub personal access token');
  });

  it('redacts absolute macOS paths', () => {
    const r = sanitizePrivacy('file at /Users/john/project/secret.ts');
    expect(r.clean).toContain('[PATH_REDACTED]');
    expect(r.clean).not.toContain('/Users/john');
    expect(r.redactions).toContain('macOS user path');
  });

  it('redacts password=value (keeps key name)', () => {
    const r = sanitizePrivacy('password=mysecret123');
    expect(r.clean).toBe('password=[REDACTED:secret]');
    expect(r.redactions).toContain('secret value');
  });

  it('redacts email addresses', () => {
    const r = sanitizePrivacy('contact me at alice@example.com');
    expect(r.clean).toContain('[REDACTED:email]');
    expect(r.clean).not.toContain('alice@example.com');
    expect(r.redactions).toContain('email address');
  });

  it('redacts IPv4 addresses (except 127.0.0.1)', () => {
    const r = sanitizePrivacy('server at 192.168.1.100, localhost 127.0.0.1');
    expect(r.clean).toContain('[REDACTED:ip]');
    expect(r.clean).not.toContain('192.168.1.100');
    // localhost must remain.
    expect(r.clean).toContain('127.0.0.1');
    expect(r.redactions).toContain('IPv4 address');
  });

  it('passes safe strings through unchanged', () => {
    const safe = 'Just a normal message with no secrets.';
    const r = sanitizePrivacy(safe);
    expect(r.clean).toBe(safe);
    expect(r.redactions).toEqual([]);
  });

  it('handles multiple redactions in one string', () => {
    const input = 'password=abc123 and key AKIAIOSFODNN7EXAMPLE from alice@test.com';
    const r = sanitizePrivacy(input);
    expect(r.redactions.length).toBeGreaterThanOrEqual(3);
    expect(r.clean).not.toContain('abc123');
    expect(r.clean).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(r.clean).not.toContain('alice@test.com');
  });
});
