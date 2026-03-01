import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import type { HiveEvent } from '../src/types/index.js';
import { EventWriter } from '../src/events/writer.js';
import { EventReader } from '../src/events/reader.js';

function buildTestEvent(overrides: Partial<HiveEvent> = {}): HiveEvent {
  return {
    event_id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    type: 'experience.created',
    timestamp: new Date().toISOString(),
    source_agent: 'test-agent',
    signature: 'hmac-sha256:test',
    payload: { exp_id: 'exp_test', initial_confidence: 0.5 },
    ...overrides,
  };
}

describe('EventWriter', () => {
  let testDir = '';

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createWriter(): EventWriter {
    testDir = path.join(os.tmpdir(), `hive-events-test-${crypto.randomUUID()}`);
    return new EventWriter({ eventsDir: testDir });
  }

  it('creates events directory if not exists', async () => {
    const writer = createWriter();
    const event = buildTestEvent();

    await writer.append(event);

    const entries = await fs.readdir(testDir);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('writes event to correct monthly file', async () => {
    const writer = createWriter();
    const now = new Date();
    const expectedName = `events-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}.jsonl`;

    await writer.append(buildTestEvent());

    const filePath = writer.getCurrentFilePath();
    expect(path.basename(filePath)).toBe(expectedName);
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('each event is a valid JSON line', async () => {
    const writer = createWriter();
    await writer.append(buildTestEvent());

    const filePath = writer.getCurrentFilePath();
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0] ?? '')).not.toThrow();
  });

  it('multiple events append correctly', async () => {
    const writer = createWriter();
    const events = [
      buildTestEvent(),
      buildTestEvent(),
      buildTestEvent(),
    ];

    for (const event of events) {
      await writer.append(event);
    }

    const filePath = writer.getCurrentFilePath();
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it("concurrent writes don't corrupt data", async () => {
    const writer = createWriter();
    const writes = Array.from({ length: 10 }, () =>
      writer.append(buildTestEvent())
    );

    await Promise.all(writes);

    const filePath = writer.getCurrentFilePath();
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(10);
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it('rejects events missing required fields', async () => {
    const writer = createWriter();
    const badEvent = buildTestEvent();
    delete (badEvent as { event_id?: string }).event_id;

    await expect(writer.append(badEvent)).rejects.toThrow('Missing required field');
  });
});

describe('EventReader', () => {
  let testDir = '';

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createReader(): EventReader {
    testDir = path.join(os.tmpdir(), `hive-events-test-${crypto.randomUUID()}`);
    return new EventReader({ eventsDir: testDir });
  }

  async function createDir(): Promise<void> {
    await fs.mkdir(testDir, { recursive: true });
  }

  async function writeRawEventFile(fileName: string, events: HiveEvent[]): Promise<void> {
    const filePath = path.join(testDir, fileName);
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    await fs.writeFile(filePath, lines, 'utf8');
  }

  it('reads events from a single file', async () => {
    const reader = createReader();
    await createDir();

    const now = new Date();
    const currentFile = `events-${now.toISOString().slice(0, 7)}.jsonl`;
    const events = [buildTestEvent(), buildTestEvent(), buildTestEvent()];
    await writeRawEventFile(currentFile, events);

    const loaded = await reader.readEvents();
    expect(loaded).toHaveLength(3);
    loaded.forEach((event, index) => {
      expect(event.event_id).toBe(events[index]!.event_id);
    });
  });

  it('reads across multiple monthly files', async () => {
    const reader = createReader();
    await createDir();

    const jan = [
      buildTestEvent({
        event_id: 'evt-jan-1',
        timestamp: '2025-01-15T12:00:00Z'
      }),
      buildTestEvent({
        event_id: 'evt-jan-2',
        timestamp: '2025-01-20T12:00:00Z'
      })
    ];
    const feb = [
      buildTestEvent({
        event_id: 'evt-feb-1',
        timestamp: '2025-02-10T12:00:00Z'
      }),
    ];

    await writeRawEventFile('events-2025-01.jsonl', jan);
    await writeRawEventFile('events-2025-02.jsonl', feb);

    const loaded = await reader.readEvents();
    expect(loaded.map((event) => event.event_id)).toEqual(['evt-jan-1', 'evt-jan-2', 'evt-feb-1']);
  });

  it('filters by date range', async () => {
    const reader = createReader();
    await createDir();

    const events: HiveEvent[] = [
      buildTestEvent({ event_id: 'evt-jan', timestamp: '2025-01-10T00:00:00Z' }),
      buildTestEvent({ event_id: 'evt-feb', timestamp: '2025-02-10T00:00:00Z' }),
      buildTestEvent({ event_id: 'evt-mar', timestamp: '2025-03-10T00:00:00Z' }),
    ];

    await writeRawEventFile('events-2025-01.jsonl', [events[0]!]);
    await writeRawEventFile('events-2025-02.jsonl', [events[1]!]);
    await writeRawEventFile('events-2025-03.jsonl', [events[2]!]);

    const loaded = await reader.readEvents({
      fromDate: new Date('2025-01-20T00:00:00Z'),
      toDate: new Date('2025-03-01T00:00:00Z'),
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.event_id).toBe('evt-feb');
  });

  it('filters by event type', async () => {
    const reader = createReader();
    await createDir();

    const events: HiveEvent[] = [
      buildTestEvent({ event_id: 'evt-created', type: 'experience.created' }),
      buildTestEvent({ event_id: 'evt-banned', type: 'strategy.banned' }),
      buildTestEvent({ event_id: 'evt-promoted', type: 'experience.promoted' }),
    ];
    await writeRawEventFile('events-2025-01.jsonl', events);

    const loaded = await reader.readEvents({
      types: ['experience.promoted', 'strategy.banned'],
    });

    expect(loaded).toHaveLength(2);
    expect(loaded.map((event) => event.type).sort()).toEqual(['experience.promoted', 'strategy.banned'].sort());
  });

  it('limits results', async () => {
    const reader = createReader();
    await createDir();

    const events = Array.from({ length: 5 }, (_, index) => buildTestEvent({
      event_id: `evt-${index}`,
      timestamp: `2025-01-0${index + 1}T00:00:00Z`
    }));
    await writeRawEventFile('events-2025-01.jsonl', events);

    const loaded = await reader.readEvents({ limit: 2 });

    expect(loaded).toHaveLength(2);
  });

  it('handles empty directory', async () => {
    const reader = createReader();
    await createDir();

    const loaded = await reader.readEvents();

    expect(loaded).toEqual([]);
  });

  it('skips malformed JSON lines', async () => {
    const reader = createReader();
    await createDir();

    const filePath = path.join(testDir, 'events-2025-01.jsonl');
    const good = buildTestEvent({ event_id: 'evt-good' });
    const lines = `${JSON.stringify(good)}\n{bad json}\n${JSON.stringify(buildTestEvent({ event_id: 'evt-good-2' }))}\n`;
    await fs.writeFile(filePath, lines, 'utf8');

    const loaded = await reader.readEvents();

    expect(loaded).toHaveLength(2);
    expect(loaded.map((event) => event.event_id)).toEqual(['evt-good', 'evt-good-2']);
  });

  it('reads .jsonl.gz files', async () => {
    const reader = createReader();
    await createDir();

    const events = [buildTestEvent({ event_id: 'evt-gz-1' }), buildTestEvent({ event_id: 'evt-gz-2' })];
    const payload = `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`;
    const gz = zlib.gzipSync(payload);
    await fs.writeFile(path.join(testDir, 'events-2025-01.jsonl.gz'), gz);

    const loaded = await reader.readEvents();
    expect(loaded.map((event) => event.event_id)).toEqual(['evt-gz-1', 'evt-gz-2']);
  });
});
