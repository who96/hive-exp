import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExperienceRecord, HiveEvent } from '@hive-exp/core';
import type { DashboardContext } from '../context.js';

interface ExperienceWithStatus extends ExperienceRecord {
  _status: 'provisional' | 'promoted' | 'archived';
  _filePath: string;
}

function readDir(
  dir: string,
  status: 'provisional' | 'promoted' | 'archived',
): ExperienceWithStatus[] {
  const results: ExperienceWithStatus[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    try {
      const filePath = path.join(dir, entry);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const record = JSON.parse(raw) as ExperienceRecord;
      results.push({ ...record, _status: status, _filePath: filePath });
    } catch {
      /* skip */
    }
  }

  return results;
}

export function experiencesRouter(ctx: DashboardContext) {
  const router = Router();

  router.get('/experiences', (_req, res) => {
    try {
      const { status, agent, limit: rawLimit, offset: rawOffset } = _req.query as Record<string, string>;
      const limit = rawLimit ? parseInt(rawLimit, 10) : 50;
      const offset = rawOffset ? parseInt(rawOffset, 10) : 0;

      let all: ExperienceWithStatus[] = [
        ...readDir(ctx.provisionalDir, 'provisional'),
        ...readDir(ctx.promotedDir, 'promoted'),
        ...readDir(ctx.archivedDir, 'archived'),
      ];

      if (status) {
        all = all.filter((r) => r._status === status);
      }
      if (agent) {
        all = all.filter((r) => r.source_agent === agent);
      }

      const total = all.length;
      const page = all.slice(offset, offset + limit);

      res.json({
        status: 'ok',
        data: {
          total,
          items: page.map(({ _filePath: _filePath, ...rest }) => rest),
        },
      });
    } catch (err) {
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  router.get('/experience/:id', (_req, res) => {
    const { id } = _req.params;
    const dirs: Array<[
      string,
      'provisional' | 'promoted' | 'archived',
    ]> = [
      [ctx.provisionalDir, 'provisional'],
      [ctx.promotedDir, 'promoted'],
      [ctx.archivedDir, 'archived'],
    ];

    for (const [dir] of dirs) {
      const filePath = path.join(dir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const record = JSON.parse(raw) as ExperienceRecord;
          const status =
            dir === ctx.provisionalDir
              ? 'provisional'
              : dir === ctx.promotedDir
                ? 'promoted'
                : 'archived';
          return res.json({ status: 'ok', data: { ...record, _status: status } });
        } catch {
          return res.status(500).json({ status: 'error', message: 'Failed to parse experience' });
        }
      }
    }

    return res.status(404).json({ status: 'error', message: 'Experience not found' });
  });

  router.post('/experience/:id/promote', async (_req, res) => {
    const { id } = _req.params;
    const filePath = path.join(ctx.provisionalDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ status: 'error', message: 'Experience not found in provisional dir' });
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const record = JSON.parse(raw) as ExperienceRecord & { pending_promotion?: boolean };

      record.provisional = false;
      record.promoted = true;
      record.provisional_deadline = null;
      delete record.pending_promotion;

      record.signature = '';
      record.signature = ctx.signer.sign(JSON.stringify(record));

      fs.writeFileSync(path.join(ctx.promotedDir, id + '.json'), JSON.stringify(record, null, 2), 'utf-8');
      fs.unlinkSync(filePath);

      const payload: { exp_id: string; promoted_by: string; auto_approved: boolean } = {
        exp_id: id,
        promoted_by: 'dashboard',
        auto_approved: false,
      };
      const event: HiveEvent = {
        event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        type: 'experience.promoted',
        timestamp: new Date().toISOString(),
        source_agent: 'dashboard',
        signature: ctx.signer.sign(JSON.stringify(payload)),
        payload,
      };

      await ctx.eventWriter.append(event);

      return res.json({ status: 'ok', data: { id, promoted: true } });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  router.post('/experience/:id/quarantine', async (_req, res) => {
    const { id } = _req.params;
    const dirs: Array<[
      string,
      'provisional' | 'promoted',
    ]> = [
      [ctx.provisionalDir, 'provisional'],
      [ctx.promotedDir, 'promoted'],
    ];

    let sourcePath: string | null = null;
    for (const [dir] of dirs) {
      const fp = path.join(dir, `${id}.json`);
      if (fs.existsSync(fp)) {
        sourcePath = fp;
        break;
      }
    }

    if (!sourcePath) {
      return res.status(404).json({ status: 'error', message: 'Experience not found' });
    }

    try {
      const raw = fs.readFileSync(sourcePath, 'utf-8');
      const record = JSON.parse(raw) as ExperienceRecord & {
        archived_reason: 'zero_ref' | 'low_confidence' | 'consecutive_fail' | null;
      };
      record.archived = true;
      record.archived_reason = record.archived_reason ?? 'consecutive_fail';

      const destPath = path.join(ctx.archivedDir, `${id}.json`);
      fs.writeFileSync(destPath, JSON.stringify(record, null, 2), 'utf-8');
      fs.unlinkSync(sourcePath);

      const payload: { exp_id: string; reason: string } = {
        exp_id: id,
        reason: 'quarantined by dashboard',
      };
      const event: HiveEvent = {
        event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        type: 'experience.quarantined',
        timestamp: new Date().toISOString(),
        source_agent: 'dashboard',
        signature: ctx.signer.sign(JSON.stringify(payload)),
        payload,
      };

      await ctx.eventWriter.append(event);
      return res.json({ status: 'ok', data: { id, archived: true } });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  return router;
}
