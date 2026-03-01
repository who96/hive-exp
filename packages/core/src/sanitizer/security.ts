export interface SanitizeResult {
  clean: string;
  violations: string[];
}

/**
 * Normalize full-width ASCII characters (U+FF01–U+FF5E) to their
 * half-width equivalents (U+0021–U+007E).
 */
function normalizeFullWidth(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    out += code >= 0xff01 && code <= 0xff5e
      ? String.fromCharCode(code - 0xfee0)
      : input[i];
  }
  return out;
}

interface Rule {
  pattern: RegExp;
  label: string;
  /** Short code used in replacement text to avoid embedding dangerous substrings. */
  code: string;
}

const RULES: Rule[] = [
  // --- Command injection ---
  { pattern: /\beval\s*\(/gi, label: 'eval() call', code: 'cmd_eval' },
  { pattern: /\bexec\s*\(/gi, label: 'exec() call', code: 'cmd_exec' },
  { pattern: /\bsystem\s*\(/gi, label: 'system() call', code: 'cmd_system' },
  { pattern: /\bspawn\s*\(/gi, label: 'spawn() call', code: 'cmd_spawn' },
  { pattern: /\bchild_process\b/gi, label: 'child_process reference', code: 'cmd_child_proc' },
  { pattern: /\brm\s+-rf\b/gi, label: 'rm -rf command', code: 'cmd_rm_rf' },
  { pattern: /`[^`]*`/g, label: 'backtick expression', code: 'cmd_backtick' },

  // --- Shell metacharacters ---
  { pattern: /\$\([^)]*\)/g, label: 'shell $() substitution', code: 'shell_subst' },
  { pattern: /\$\{[^}]*\}/g, label: 'shell ${} expansion', code: 'shell_expand' },
  { pattern: /\|(?:\s*\w)/g, label: 'pipe chain', code: 'shell_pipe' },
  { pattern: /&&\s*\w/g, label: 'shell && chain', code: 'shell_and' },

  // --- Script injection ---
  { pattern: /<\s*script[^>]*>[\s\S]*?(<\s*\/\s*script\s*>|$)/gi, label: '<script> tag', code: 'xss_script' },
  { pattern: /javascript\s*:/gi, label: 'javascript: URI', code: 'xss_js_uri' },
  { pattern: /data\s*:\s*text\/html/gi, label: 'data:text/html URI', code: 'xss_data_uri' },
  { pattern: /\bon(error|load|click|mouseover|focus|blur)\s*=/gi, label: 'inline event handler', code: 'xss_handler' },

  // --- SQL injection ---
  { pattern: /'\s*;\s*DROP\s+TABLE\b/gi, label: 'SQL DROP TABLE injection', code: 'sql_drop' },
  { pattern: /\bUNION\s+SELECT\b/gi, label: 'SQL UNION SELECT injection', code: 'sql_union' },
  { pattern: /\bOR\s+1\s*=\s*1\b/gi, label: 'SQL OR 1=1 injection', code: 'sql_tautology' },
  { pattern: /--\s*$/gm, label: 'SQL comment terminator', code: 'sql_comment' },

  // --- Path traversal (specific paths before generic ../ so they match first) ---
  { pattern: /\/etc\/passwd/gi, label: '/etc/passwd access', code: 'path_etc_passwd' },
  { pattern: /\/etc\/shadow/gi, label: '/etc/shadow access', code: 'path_etc_shadow' },
  { pattern: /\.\.[\\/]/g, label: 'path traversal', code: 'path_traversal' },

  // --- Null bytes ---
  { pattern: /\0/g, label: 'null byte', code: 'null_byte' },
  { pattern: /%00/gi, label: 'encoded null byte', code: 'null_byte_enc' },

  // --- CRLF injection ---
  { pattern: /\r\n/g, label: 'CRLF injection', code: 'crlf' },
];

export function sanitizeSecurity(input: string): SanitizeResult {
  const violations: string[] = [];

  // Normalize full-width chars so unicode variants of dangerous
  // keywords (ｅｖａｌ, ｅｘｅｃ, etc.) are caught by the same rules.
  let working = normalizeFullWidth(input);

  for (const rule of RULES) {
    // Reset lastIndex for stateful regexps.
    rule.pattern.lastIndex = 0;

    if (rule.pattern.test(working)) {
      violations.push(rule.label);
      // Reset again before replace.
      rule.pattern.lastIndex = 0;
      working = working.replace(rule.pattern, `[REDACTED:${rule.code}]`);
    }
  }

  return { clean: working, violations };
}
