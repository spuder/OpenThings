import { describe, expect, it } from 'vitest';
import { dumpDropFields, upcomingDropDate, weekDropDate } from './dumpDrop';

const day = '2026-10-31';
const item = { dump: 1, completed_at: null } as const;
const out = { dump: 0, dump_section_id: null };

describe('dumpDropFields', () => {
  it('Today schedules it for today and leaves the dump', () => {
    expect(dumpDropFields(item, { kind: 'today' }, day)).toEqual({ ...out, when_date: day, evening: 0, someday: 0 });
  });
  it('Upcoming schedules it for tomorrow', () => {
    expect(upcomingDropDate(day)).toBe('2026-11-01');
    expect(dumpDropFields(item, { kind: 'upcoming' }, day)?.when_date).toBe('2026-11-01');
    expect(upcomingDropDate('2026-12-31')).toBe('2027-01-01');
  });
  it('This Week: tomorrow, or today on Sunday', () => {
    expect(weekDropDate('2026-10-28')).toBe('2026-10-29'); // Wednesday
    expect(weekDropDate('2026-11-01')).toBe('2026-11-01'); // Sunday
    expect(dumpDropFields(item, { kind: 'week' }, '2026-10-28')?.when_date).toBe('2026-10-29');
  });
  it('Inbox clears project and area', () => {
    expect(dumpDropFields(item, { kind: 'inbox' }, day)).toEqual({ ...out, when_date: null, evening: 0, someday: 0, project_id: null, area_id: null, heading_id: null });
  });
  it('Anytime and Someday', () => {
    expect(dumpDropFields(item, { kind: 'anytime' }, day)).toEqual({ ...out, when_date: null, evening: 0, someday: 0 });
    expect(dumpDropFields(item, { kind: 'someday' }, day)?.someday).toBe(1);
  });
  it('a project or an area files it there', () => {
    expect(dumpDropFields(item, { kind: 'project', id: 'p1' }, day)).toEqual({ ...out, project_id: 'p1', area_id: null, heading_id: null });
    expect(dumpDropFields(item, { kind: 'area', id: 'a1' }, day)).toEqual({ ...out, project_id: null, area_id: 'a1', heading_id: null });
  });
  it('ignores other lists, done items and normal to-dos', () => {
    for (const kind of ['dump', 'logbook', 'trash', 'habits', 'matrix'] as const) expect(dumpDropFields(item, { kind } as never, day)).toBeNull();
    expect(dumpDropFields({ dump: 1, completed_at: '2026-10-31T00:00:00Z' }, { kind: 'today' }, day)).toBeNull();
    expect(dumpDropFields({ dump: 0, completed_at: null }, { kind: 'today' }, day)).toBeNull();
  });
});
