import { describe, expect, it } from 'vitest';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { decodeThingsDate, mergeImportedTags, parseThingsDatabase } from './things';

/** Things packs a calendar date into (year << 16) | (month << 12) | (day << 7). */
const packed = (year: number, month: number, day: number) => (year << 16) | (month << 12) | (day << 7);

function insert(db: Database, table: string, row: Record<string, SqlValue>) {
  const cols = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
}

/**
 * A small database with the Things 3 tables and edge cases we care about:
 * nested structure, trashed rows, cancel/completion, duplicates, repeaters.
 */
async function fixture(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, title TEXT, visible INTEGER, "index" INTEGER);
    CREATE TABLE TMTask (
      uuid TEXT PRIMARY KEY, type INTEGER, status INTEGER, trashed INTEGER,
      title TEXT, notes TEXT, creationDate REAL, userModificationDate REAL, stopDate REAL,
      start INTEGER, startDate INTEGER, startBucket INTEGER, deadline INTEGER,
      "index" INTEGER, area TEXT, project TEXT, heading TEXT, reminderTime INTEGER,
      rt1_recurringTemplate TEXT, rt1_recurrenceRule BLOB, rt1_repeatingTemplate TEXT, repeater BLOB
    );
    CREATE TABLE TMTag (uuid TEXT PRIMARY KEY, title TEXT, parent TEXT, "index" INTEGER);
    CREATE TABLE TMTaskTag (tasks TEXT NOT NULL, tags TEXT NOT NULL);
    CREATE TABLE TMChecklistItem (uuid TEXT PRIMARY KEY, title TEXT, status INTEGER, task TEXT, "index" INTEGER);
  `);

  insert(db, 'TMArea', { uuid: 'area-work', title: 'Work', visible: 1, index: 0 });
  insert(db, 'TMArea', { uuid: 'area-home', title: 'Home', visible: 1, index: 1 });

  insert(db, 'TMTask', {
    uuid: 'project-launch', type: 1, status: 0, trashed: 0, title: 'Launch',
    notes: 'Project notes', index: 0, area: 'area-work', creationDate: 1700000000,
  });
  insert(db, 'TMTask', { uuid: 'project-gone', type: 1, status: 0, trashed: 1, title: 'Gone project', index: 1, area: 'area-work' });
  insert(db, 'TMTask', { uuid: 'project-blank', type: 1, status: 0, trashed: 0, title: '  ', index: 2 });

  insert(db, 'TMTask', {
    uuid: 'heading-phase', type: 2, status: 0, trashed: 0, title: 'Phase 1',
    index: 0, project: 'project-launch',
  });

  const task = (uuid: string, fields: Record<string, SqlValue>) =>
    insert(db, 'TMTask', {
      uuid, type: 0, status: 0, trashed: 0, title: uuid, notes: '', creationDate: 1700000000,
      userModificationDate: 1700000100, start: 1, index: 0, ...fields,
    });

  task('todo-ship', {
    title: 'Ship it',
    project: 'project-launch',
    heading: 'heading-phase',
    notes: 'Details',
    startDate: packed(2026, 10, 15),
    deadline: packed(2026, 10, 20),
    index: 1,
    reminderTime: 1,
    rt1_recurrenceRule: Uint8Array.from([1, 2, 3]),
  });
  task('todo-milk', { title: 'Buy milk', start: 0, index: 2 });
  task('todo-piano', { title: 'Learn piano', start: 2, startDate: packed(2027, 1, 1), index: 3 });
  task('todo-done', {
    title: 'Finished thing', project: 'project-launch', status: 3, stopDate: 1760100000, index: 4,
  });
  task('todo-canceled', { title: 'Dropped thing', status: 2, stopDate: 1760200000, index: 5 });
  task('todo-trashed', { title: 'Old thing', trashed: 1, index: 6 });
  task('todo-blank', { title: '   ', index: 7 });
  task('todo-orphan', { title: 'In trashed project', project: 'project-gone', index: 8 });
  task('todo-home', { title: 'Fix the sink', start: 0, area: 'area-home', startDate: packed(2026, 10, 14), index: 9 });
  task('todo-due-only', { title: 'Renew passport', start: 0, deadline: packed(2026, 11, 1), index: 10 });

  insert(db, 'TMTag', { uuid: 'tag-work', title: 'work', index: 0 });
  insert(db, 'TMTag', { uuid: 'tag-home', title: 'home', index: 1 });
  insert(db, 'TMTag', { uuid: 'tag-blank', title: ' ', index: 2 });

  insert(db, 'TMTaskTag', { tasks: 'todo-ship', tags: 'tag-work' });
  insert(db, 'TMTaskTag', { tasks: 'todo-ship', tags: 'tag-work' });
  insert(db, 'TMTaskTag', { tasks: 'todo-ship', tags: 'tag-home' });
  insert(db, 'TMTaskTag', { tasks: 'todo-milk', tags: 'tag-home' });
  insert(db, 'TMTaskTag', { tasks: 'todo-trashed', tags: 'tag-work' });

  insert(db, 'TMChecklistItem', { uuid: 'check-docs', title: 'Write docs', status: 3, task: 'todo-ship', index: 0 });
  insert(db, 'TMChecklistItem', { uuid: 'check-ship', title: 'Ship build', status: 0, task: 'todo-ship', index: 1 });
  insert(db, 'TMChecklistItem', { uuid: 'check-blank', title: '  ', status: 0, task: 'todo-ship', index: 2 });
  insert(db, 'TMChecklistItem', { uuid: 'check-trashed', title: 'Gone', status: 0, task: 'todo-trashed', index: 3 });

  return db;
}

describe('decodeThingsDate', () => {
  it('reads the packed date format used by current Things releases', () => {
    expect(packed(2026, 10, 15)).toBe(132818816);
    expect(decodeThingsDate(132818816)).toBe('2026-10-15');
    expect(decodeThingsDate(132718976)).toBe('2025-02-03');
    expect(decodeThingsDate(133107840)).toBe('2031-01-01');
  });

  it('falls back to seconds since 2001 for older databases', () => {
    expect(decodeThingsDate(757382400)).toBe('2025-01-01');
  });

  it('treats far-future packed sentinels like 4001-01-01 as no date (#100)', () => {
    expect(packed(4001, 1, 1)).toBe(262213760);
    expect(decodeThingsDate(262213760)).toBeNull();
  });

  it('treats zero, null and empty values as no date', () => {
    expect(decodeThingsDate(0)).toBeNull();
    expect(decodeThingsDate(null)).toBeNull();
    expect(decodeThingsDate(undefined)).toBeNull();
  });
});

describe('parseThingsDatabase', () => {
  it('maps areas, projects, headings and to-dos', async () => {
    const db = await fixture();
    const plan = parseThingsDatabase(db);
    db.close();

    expect(plan.stats.areas).toBe(2);
    expect(plan.stats.projects).toBe(2);
    expect(plan.stats.headings).toBe(1);
    expect(plan.stats.todos).toBe(7);
    expect(plan.stats.open).toBe(5);
    expect(plan.stats.completed).toBe(1);
    expect(plan.stats.canceled).toBe(1);
    expect(plan.stats.checklist).toBe(2);
    expect(plan.stats.tags).toBe(2);
    expect(plan.stats.taskTags).toBe(3);
    expect(plan.stats.skippedTrashed).toBe(2);
    expect(plan.stats.skippedEmpty).toBe(1);
    expect(plan.stats.skippedOrphans).toBe(1);
    expect(plan.stats.repeating).toBe(1);
    expect(plan.stats.reminders).toBe(1);

    const work = plan.areas.find((a) => a.name === 'Work')!;
    const home = plan.areas.find((a) => a.name === 'Home')!;
    expect(work).toBeTruthy();
    expect(home).toBeTruthy();

    const launch = plan.projects.find((p) => p.name === 'Launch')!;
    expect(launch.area_id).toBe(work.id);
    expect(launch.notes).toBe('Project notes');
    expect(launch.completed_at).toBeNull();
    expect(plan.projects.some((p) => p.name === 'Untitled project')).toBe(true);

    const heading = plan.headings[0];
    expect(heading.name).toBe('Phase 1');
    expect(heading.project_id).toBe(launch.id);

    const byTitle = new Map(plan.tasks.map((t) => [t.title, t]));
    expect([...byTitle.keys()].sort()).toEqual([
      'Buy milk', 'Dropped thing', 'Finished thing', 'Fix the sink', 'Learn piano', 'Renew passport', 'Ship it',
    ]);

    const ship = byTitle.get('Ship it')!;
    expect(ship.project_id).toBe(launch.id);
    expect(ship.heading_id).toBe(heading.id);
    expect(ship.area_id).toBeNull();
    expect(ship.when_date).toBe('2026-10-15');
    expect(ship.deadline).toBe('2026-10-20');
    expect(ship.notes).toBe('Details');
    expect(ship.completed_at).toBeNull();
    expect(ship.someday).toBe(0);

    const milk = byTitle.get('Buy milk')!;
    expect(milk.project_id).toBeNull();
    expect(milk.area_id).toBeNull();
    expect(milk.when_date).toBeNull();
    expect(milk.someday).toBe(0);

    const piano = byTitle.get('Learn piano')!;
    expect(piano.someday).toBe(1);
    expect(piano.when_date).toBeNull();

    const sink = byTitle.get('Fix the sink')!;
    expect(sink.area_id).toBe(home.id);
    expect(sink.when_date).toBe('2026-10-14');

    const passport = byTitle.get('Renew passport')!;
    expect(passport.when_date).toBeNull();
    expect(passport.deadline).toBe('2026-11-01');

    expect(byTitle.get('Finished thing')!.completed_at).not.toBeNull();
    expect(byTitle.get('Dropped thing')!.completed_at).not.toBeNull();
  });

  it('links tags and checklist items only to imported rows', async () => {
    const db = await fixture();
    const plan = parseThingsDatabase(db);
    db.close();

    const ship = plan.tasks.find((t) => t.title === 'Ship it')!;
    const tagName = (id: string) => plan.tags.find((t) => t.id === id)?.name;
    expect(plan.taskTags.filter((tt) => tt.task_id === ship.id).map((tt) => tagName(tt.tag_id)).sort()).toEqual(['home', 'work']);
    expect(plan.taskTags.some((tt) => tt.task_id === plan.tasks.find((t) => t.title === 'Buy milk')!.id)).toBe(true);

    expect(plan.checklist.map((c) => [c.title, c.done])).toEqual([
      ['Write docs', 1],
      ['Ship build', 0],
    ]);
    expect(plan.checklist.every((c) => c.task_id === ship.id)).toBe(true);
  });

  it('explains what was left behind', async () => {
    const db = await fixture();
    const plan = parseThingsDatabase(db);
    db.close();

    const all = plan.warnings.join('\n');
    expect(all).toContain('repeating to-do');
    expect(all).toContain('reminder');
    expect(all).toContain('canceled to-do');
    expect(all).toContain('Things Trash');
    expect(all).toContain('trashed project');
  });

  it('rejects a database that is not a Things database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE something_else (id TEXT)');
    expect(() => parseThingsDatabase(db)).toThrow(/Things/);
    db.close();
  });
});


describe('mergeImportedTags', () => {
  it('reuses existing tag names case-insensitively and remaps links', async () => {
    const existing = [{ id: 'existing-work', name: 'Work' }];
    const imported = [
      { id: 'new-work', name: 'work' },
      { id: 'new-home', name: 'home' },
    ];
    const links = [
      { id: 'l1', task_id: 'task', tag_id: 'new-work' },
      { id: 'l2', task_id: 'task', tag_id: 'new-home' },
    ];
    const merged = mergeImportedTags(existing, imported, links);
    expect(merged.tags).toEqual([{ id: 'new-home', name: 'home' }]);
    expect(merged.taskTags.map((l) => l.tag_id)).toEqual(['existing-work', 'new-home']);
  });

  it('keeps imported tags that have no match', async () => {
    const imported = [{ id: 'new-work', name: 'work' }];
    const merged = mergeImportedTags([], imported, []);
    expect(merged.tags).toEqual(imported);
  });
});
