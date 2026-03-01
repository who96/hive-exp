import { readFile } from 'node:fs/promises';

import type { MemoryGraphEntry } from './writer.js';

export type { MemoryGraphEntry } from './writer.js';

export interface MemoryGraphQueryOptions {
  filePath: string;
}

export interface QueryFilter {
  signal?: string;
  strategy_name?: string;
  source_agent?: string;
  outcome?: 'success' | 'failed' | 'partial';
  limit?: number;
}

export class MemoryGraphQuery {
  private filePath: string;

  constructor(options: MemoryGraphQueryOptions) {
    this.filePath = options.filePath;
  }

  private async readAll(): Promise<MemoryGraphEntry[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }

    const entries: MemoryGraphEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        entries.push(JSON.parse(trimmed) as MemoryGraphEntry);
      } catch {
        // skip malformed lines
      }
    }

    return entries;
  }

  async query(filter: QueryFilter): Promise<MemoryGraphEntry[]> {
    const all = await this.readAll();

    let results = all.filter((entry) => {
      if (filter.signal !== undefined && entry.signal !== filter.signal) return false;
      if (filter.strategy_name !== undefined && entry.strategy_name !== filter.strategy_name) return false;
      if (filter.source_agent !== undefined && entry.source_agent !== filter.source_agent) return false;
      if (filter.outcome !== undefined && entry.outcome !== filter.outcome) return false;
      return true;
    });

    // Sort chronologically by timestamp
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async getCausalChain(expId: string): Promise<MemoryGraphEntry[]> {
    const all = await this.readAll();
    const byId = new Map<string, MemoryGraphEntry>();
    for (const entry of all) {
      byId.set(entry.exp_id, entry);
    }

    const visited = new Set<string>();
    const chain: MemoryGraphEntry[] = [];

    // BFS with max depth 10
    const queue: Array<{ id: string; depth: number }> = [{ id: expId, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift()!;

      if (visited.has(item.id)) continue;
      if (item.depth > 10) continue;

      visited.add(item.id);

      const entry = byId.get(item.id);
      if (!entry) continue;

      chain.push(entry);

      for (const relatedId of entry.related_exp_ids) {
        if (!visited.has(relatedId)) {
          queue.push({ id: relatedId, depth: item.depth + 1 });
        }
      }
    }

    // Sort chronologically
    chain.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return chain;
  }
}
