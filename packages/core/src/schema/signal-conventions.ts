import type { SignalConvention } from '../types/index.js';

export const SIGNAL_CONVENTIONS: SignalConvention[] = [
  {
    name: 'tsc_error',
    aliases: ['typescript_compilation_failed', 'build_error_ts', 'ts_compiler_error'],
    detect_pattern: '\\b(tsc|typescript).*(error|failed)\\b',
    description: 'TypeScript compiler errors detected during build.',
    category: 'build'
  },
  {
    name: 'build_failed',
    aliases: ['build_error', 'build_break', 'compile_pipeline_failed'],
    detect_pattern: '\\bbuild\\b.*(failed|error)',
    description: 'General project build pipeline failure.',
    category: 'build'
  },
  {
    name: 'compilation_error',
    aliases: ['compile_error', 'compile_failed'],
    detect_pattern: '\\bcompil(e|ation)\\b.*(error|failed)',
    description: 'Compilation failure for non-TypeScript toolchains.',
    category: 'build'
  },
  {
    name: 'module_not_found',
    aliases: ['cannot_find_module', 'module_missing', 'err_module_not_found'],
    detect_pattern: 'Cannot find module|module not found|ERR_MODULE_NOT_FOUND',
    description: 'Runtime or build cannot resolve a module import.',
    category: 'module'
  },
  {
    name: 'import_error',
    aliases: ['import_failed', 'invalid_import'],
    detect_pattern: '\\bimport\\b.*(error|failed|invalid)',
    description: 'Import statement is invalid or fails to resolve correctly.',
    category: 'module'
  },
  {
    name: 'circular_dependency',
    aliases: ['cycle_dependency', 'dependency_cycle'],
    detect_pattern: 'circular dependency|dependency cycle',
    description: 'Detected circular dependency in module graph.',
    category: 'module'
  },
  {
    name: 'test_failed',
    aliases: ['test_error', 'unit_test_failed', 'spec_failed'],
    detect_pattern: '\\b(test|spec)\\b.*(failed|failure|error)',
    description: 'One or more tests failed.',
    category: 'test'
  },
  {
    name: 'test_timeout',
    aliases: ['test_timed_out', 'timeout_test', 'spec_timeout'],
    detect_pattern: 'test.*timed? out|timeout.*test',
    description: 'Test execution exceeded timeout threshold.',
    category: 'test'
  },
  {
    name: 'assertion_error',
    aliases: ['assert_failed', 'expectation_failed'],
    detect_pattern: 'AssertionError|expected .* to',
    description: 'Assertion mismatch in tests or runtime checks.',
    category: 'test'
  },
  {
    name: 'lint_error',
    aliases: ['eslint_error', 'lint_failed'],
    detect_pattern: '(eslint|lint).*(error|failed)',
    description: 'Linting produced blocking errors.',
    category: 'lint'
  },
  {
    name: 'lint_warning',
    aliases: ['eslint_warning', 'lint_warn'],
    detect_pattern: '(eslint|lint).*(warning|warn)',
    description: 'Linting produced warnings.',
    category: 'lint'
  },
  {
    name: 'type_error',
    aliases: ['runtime_type_error', 'js_type_error'],
    detect_pattern: 'TypeError',
    description: 'Runtime TypeError exception.',
    category: 'runtime'
  },
  {
    name: 'null_reference',
    aliases: ['null_pointer', 'undefined_reference'],
    detect_pattern: 'null reference|cannot read (properties|property) of (null|undefined)|undefined is not an object',
    description: 'Code attempted to access members on null/undefined.',
    category: 'runtime'
  },
  {
    name: 'unhandled_rejection',
    aliases: ['unhandled_promise_rejection', 'promise_rejection_unhandled'],
    detect_pattern: 'UnhandledPromiseRejection|unhandled rejection',
    description: 'Unhandled promise rejection surfaced at runtime.',
    category: 'runtime'
  },
  {
    name: 'dependency_vulnerability',
    aliases: ['vulnerability_found', 'security_advisory', 'npm_audit_fail'],
    detect_pattern: 'vulnerab|CVE-\\d{4}-\\d+|npm audit',
    description: 'Security vulnerability found in dependency graph.',
    category: 'security'
  },
  {
    name: 'config_invalid',
    aliases: ['invalid_configuration', 'config_error'],
    detect_pattern: 'config(uration)?.*(invalid|error)',
    description: 'Configuration value or file is malformed.',
    category: 'config'
  },
  {
    name: 'env_missing',
    aliases: ['missing_env', 'environment_variable_missing'],
    detect_pattern: 'env(ironment)? variable .*missing|missing required env|process\\.env',
    description: 'Required environment variable is absent.',
    category: 'config'
  }
];

const directMap = new Map<string, string>();
const regexMatchers = SIGNAL_CONVENTIONS.map((convention) => ({
  name: convention.name,
  regex: new RegExp(convention.detect_pattern, 'i')
}));

for (const convention of SIGNAL_CONVENTIONS) {
  directMap.set(convention.name.toLowerCase(), convention.name);
  for (const alias of convention.aliases) {
    directMap.set(alias.toLowerCase(), convention.name);
  }
}

export function normalizeSignal(rawSignal: string): string {
  const normalized = rawSignal.trim().toLowerCase();
  const direct = directMap.get(normalized);
  if (direct) {
    return direct;
  }

  for (const matcher of regexMatchers) {
    if (matcher.regex.test(rawSignal)) {
      return matcher.name;
    }
  }

  return rawSignal;
}
