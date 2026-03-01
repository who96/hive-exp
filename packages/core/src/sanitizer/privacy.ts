export interface PrivacySanitizeResult {
  clean: string;
  redactions: string[];
}

interface RedactionRule {
  pattern: RegExp;
  label: string;
  replacer: (match: string, ...groups: string[]) => string;
}

const REDACTION_RULES: RedactionRule[] = [
  // --- API keys (specific prefixes) ---
  {
    pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    label: 'OpenAI API key',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bAKIA[A-Z0-9]{12,}\b/g,
    label: 'AWS access key',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bghp_[A-Za-z0-9]{8,}\b/g,
    label: 'GitHub personal access token',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bghu_[A-Za-z0-9]{8,}\b/g,
    label: 'GitHub user token',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
    label: 'GitHub PAT',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bxoxb-[A-Za-z0-9-]{8,}\b/g,
    label: 'Slack bot token',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\bxoxp-[A-Za-z0-9-]{8,}\b/g,
    label: 'Slack user token',
    replacer: () => '[REDACTED:api_key]',
  },
  {
    pattern: /\b[Bb]earer\s+[A-Za-z0-9_.~+/=-]{8,}\b/g,
    label: 'Bearer token',
    replacer: () => '[REDACTED:bearer_token]',
  },

  // --- Generic secrets (key=value form) ---
  // Keeps the key name, redacts the value.
  {
    pattern: /\b(api_key|key|secret|password|token|passwd)\s*=\s*\S+/gi,
    label: 'secret value',
    replacer: (_match, key: string) => `${key}=[REDACTED:secret]`,
  },

  // --- Sensitive filenames ---
  {
    pattern: /\b(\.env(\.local)?|credentials\.json|id_rsa|id_ed25519|\.npmrc)\b/g,
    label: 'sensitive filename',
    replacer: () => '[REDACTED:filename]',
  },

  // --- Absolute paths ---
  {
    pattern: /\/Users\/[^\s'"`,;)}\]]+/g,
    label: 'macOS user path',
    replacer: () => '[PATH_REDACTED]',
  },
  {
    pattern: /\/home\/[^\s'"`,;)}\]]+/g,
    label: 'Linux user path',
    replacer: () => '[PATH_REDACTED]',
  },
  {
    pattern: /[A-Z]:\\Users\\[^\s'"`,;)}\]]+/g,
    label: 'Windows user path',
    replacer: () => '[PATH_REDACTED]',
  },

  // --- Email addresses ---
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    label: 'email address',
    replacer: () => '[REDACTED:email]',
  },

  // --- IPv4 addresses (except 127.0.0.1) ---
  {
    pattern: /\b(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    label: 'IPv4 address',
    replacer: (match) => {
      // Only redact plausible IPs (each octet 0-255).
      const parts = match.split('.');
      const valid = parts.every((p) => {
        const n = Number(p);
        return n >= 0 && n <= 255;
      });
      return valid ? '[REDACTED:ip]' : match;
    },
  },
];

export function sanitizePrivacy(input: string): PrivacySanitizeResult {
  const redactions: string[] = [];
  let working = input;

  for (const rule of REDACTION_RULES) {
    rule.pattern.lastIndex = 0;

    if (rule.pattern.test(working)) {
      redactions.push(rule.label);
      rule.pattern.lastIndex = 0;
      working = working.replace(rule.pattern, rule.replacer as (...args: string[]) => string);
    }
  }

  return { clean: working, redactions };
}
