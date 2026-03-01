import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExperienceRecord } from '@hive-exp/core';

export function generateExpId(): string {
  return `exp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function findExperienceFile(dataDir: string, expId: string): string | null {
  const subdirs = ['provisional', 'promoted', 'archived'];
  for (const sub of subdirs) {
    const filePath = path.join(dataDir, 'experiences', sub, `${expId}.json`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export function readExperienceFile(filePath: string): ExperienceRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExperienceRecord;
}

export function writeExperienceFile(filePath: string, record: ExperienceRecord): void {
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRow);
  });
  const sep = widths.map((w) => '-'.repeat(w)).join(' | ');
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const bodyLines = rows.map((row) => row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join(' | '));
  return [headerLine, sep, ...bodyLines].join('\n');
}
