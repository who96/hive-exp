import { mkdir, appendFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MemoryGraphEntry {
  exp_id: string;
  signal: string;
  strategy_name: string;
  source_agent: string;
  timestamp: string;
  outcome: 'success' | 'failed' | 'partial';
  related_exp_ids: string[];
  confidence: number;
}

export interface MemoryGraphWriterOptions {
  filePath: string;
}

const REQUIRED_FIELDS: (keyof MemoryGraphEntry)[] = [
  'exp_id',
  'signal',
  'strategy_name',
  'source_agent',
  'timestamp',
  'outcome',
  'related_exp_ids',
  'confidence',
];

const VALID_OUTCOMES = new Set(['success', 'failed', 'partial']);

function validate(entry: MemoryGraphEntry): void {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  if (typeof entry.exp_id !== 'string' || entry.exp_id.length === 0) {
    throw new Error('exp_id must be a non-empty string');
  }

  if (typeof entry.signal !== 'string' || entry.signal.length === 0) {
    throw new Error('signal must be a non-empty string');
  }

  if (typeof entry.strategy_name !== 'string' || entry.strategy_name.length === 0) {
    throw new Error('strategy_name must be a non-empty string');
  }

  if (typeof entry.source_agent !== 'string' || entry.source_agent.length === 0) {
    throw new Error('source_agent must be a non-empty string');
  }

  if (typeof entry.timestamp !== 'string' || entry.timestamp.length === 0) {
    throw new Error('timestamp must be a non-empty string');
  }

  if (!VALID_OUTCOMES.has(entry.outcome)) {
    throw new Error(`outcome must be one of: success, failed, partial`);
  }

  if (!Array.isArray(entry.related_exp_ids)) {
    throw new Error('related_exp_ids must be an array');
  }

  if (typeof entry.confidence !== 'number' || entry.confidence < 0 || entry.confidence > 1) {
    throw new Error('confidence must be a number between 0 and 1');
  }
}

export class MemoryGraphWriter {
  private filePath: string;

  constructor(options: MemoryGraphWriterOptions) {
    this.filePath = options.filePath;
  }

  async append(entry: MemoryGraphEntry): Promise<void> {
    validate(entry);

    const dir = dirname(this.filePath);

    try {
      await access(dir);
    } catch {
      await mkdir(dir, { recursive: true });
    }

    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.filePath, line, 'utf-8');
  }
}
