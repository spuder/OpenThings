import { describe, expect, it } from 'vitest';
import { blockEvents, calendar, escapeText, etag, fold, localStamp, utcStamp } from './ical';
import type { Area, Project, Task, TimeBlock } from './types';

const block = (id: string, p: Partial<TimeBlock> = {}): TimeBlock => ({
  id, start_at: '2026-10-31T09:00', end_at: '2026-10-31T10:30', title: null, area_id: null, project_id: null, task_id: null,
  calendar_id: null, created_at: '2026-10-30T12:00:00.000Z', deleted_at: null, ...p,
});
const areas: Area[] = [{ id: 'a1', name: 'Vehicles', sort: 0 }];
const projects = [{ id: 'p1', area_id: 'a1', name: 'Truck maintenance', notes: '', sort: 0, completed_at: null }] as Project[];
const tasks = [{ id: 't1', project_id: 'p1', title: 'Change oil' }] as Task[];

describe('iCalendar', () => {
  it('escapes text and formats floating and UTC times', () => {
    expect(escapeText('Taxes; forms, receipts\nand \\ more')).toBe('Taxes\\; forms\\, receipts\\nand \\\\ more');
    expect(localStamp('2026-10-31T09:15')).toBe('20261031T091500');
    expect(utcStamp('2026-10-30T12:00:00.000Z')).toBe('20261030T120000Z');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = fold(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('names the calendar OpenThings by default', () => {
    const ics = calendar([]);
    expect(ics).toContain('X-WR-CALNAME:OpenThings\r\n');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(calendar([], { name: 'Work blocks', timezone: 'America/Denver' })).toMatch(/X-WR-CALNAME:Work blocks\r\n[\s\S]*X-WR-TIMEZONE:America\/Denver/);
  });

  it('turns blocks into events titled by their deepest level', () => {
    const ev = blockEvents(
      [block('b2', { start_at: '2026-10-31T13:00', end_at: '2026-10-31T14:00', title: 'Taxes' }), block('b1', { area_id: 'a1', project_id: 'p1', task_id: 't1' }), block('gone', { deleted_at: '2026-10-31T00:00:00Z' })],
      areas,
      projects,
      tasks,
    );
    expect(ev.map((e) => e.uid)).toEqual(['b1@openthings', 'b2@openthings']);
    expect(ev[0]).toMatchObject({ summary: 'Change oil', description: 'Vehicles › Truck maintenance › Change oil', categories: 'Vehicles' });
    expect(ev[1]).toMatchObject({ summary: 'Taxes', description: undefined, categories: undefined });
    const ics = calendar(ev);
    expect(ics).toContain('DTSTART:20261031T090000\r\nDTEND:20261031T103000\r\n');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('ends a block at midnight on the next day', () => {
    const [e] = blockEvents([block('b', { start_at: '2026-10-31T23:00', end_at: '2026-11-01T00:00' })], [], [], []);
    expect(calendar([e])).toContain('DTEND:20261101T000000');
  });

  it('hashes to a stable short tag', () => {
    expect(etag('abc')).toBe(etag('abc'));
    expect(etag('abc')).not.toBe(etag('abd'));
    expect(etag('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
