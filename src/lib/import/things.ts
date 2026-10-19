/**
 * Import an existing Things 3 database.
 *
 * Things 3 has no documented export format, so this reads the SQLite file the
 * app keeps on the user's own Mac:
 *
 *   ~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/
 *     ThingsData-XXXXX/Things Database.thingsdatabase/main.sqlite
 *
 * Only the tables needed to rebuild areas, projects, headings, to-dos, tags and
 * checklists are read. Nothing is written back, and no Cultured Code code is
 * used: the mapping below is an independent implementation based on the public
 * shape of the file (see docs/import.md).
 *
 * The file is opened in memory with sql.js, so importing never touches the
 * original database.
 */
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { uuid7 } from '../db';
import { ymd } from '../dates';
import type { Area, ChecklistItem, Heading, Project, Tag, Task, TaskTag } from '../types';

/** Columns in TMTask whose meanings changed across Things releases. */
const COL = {
  heading: ['heading', 'actionGroup'],
  deadline: ['deadline', 'dueDate'],
} as const;

export interface ThingsImportStats {
  areas: number;
  projects: number;
  headings: number;
  /** Non-trashed, non-empty to-dos that will be imported. */
  todos: number;
  open: number;
  completed: number;
  /** Canceled in Things; imported as completed, since OpenThings has no Dropped state. */
  canceled: number;
  checklist: number;
  tags: number;
  taskTags: number;
  /** Items in the Things Trash, left behind. */
  skippedTrashed: number;
  /** Rows with no title, left behind. */
  skippedEmpty: number;
  skippedOrphans: number;
  /** Repeating to-dos are imported once; the repeat rule is not carried over. */
  repeating: number;
  /** To-dos with a Things reminder time; the reminder is not carried over. */
  reminders: number;
}

export interface ThingsImport {
  areas: Area[];
  projects: Project[];
  headings: Heading[];
  tasks: Task[];
  checklist: ChecklistItem[];
  tags: Tag[];
  taskTags: TaskTag[];
  stats: ThingsImportStats;
  warnings: string[];
}

/**
 * Tag names are unique in OpenThings, so reuse an existing tag when the name
 * matches (case-insensitively) instead of failing the whole import. This also
 * makes a second import of the same database possible.
 */
export function mergeImportedTags(
  existing: readonly Tag[],
  imported: readonly Tag[],
  links: readonly TaskTag[],
): { tags: Tag[]; taskTags: TaskTag[] } {
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const idMap = new Map<string, string>();
  const tags: Tag[] = [];
  for (const tag of imported) {
    const key = tag.name.toLowerCase();
    const existingId = byName.get(key);
    if (existingId) {
      idMap.set(tag.id, existingId);
    } else {
      byName.set(key, tag.id);
      tags.push(tag);
    }
  }
  return {
    tags,
    taskTags: links.map((link) => ({ ...link, tag_id: idMap.get(link.tag_id) ?? link.tag_id })),
  };
}

type ThingsRow = Record<string, SqlValue>;

const emptyStats = (): ThingsImportStats => ({
  areas: 0,
  projects: 0,
  headings: 0,
  todos: 0,
  open: 0,
  completed: 0,
  canceled: 0,
  checklist: 0,
  tags: 0,
  taskTags: 0,
  skippedTrashed: 0,
  skippedEmpty: 0,
  skippedOrphans: 0,
  repeating: 0,
  reminders: 0,
});

/** sql.js keeps the compiled WASM module around; one compile per session is enough. */
let sqlPromise: Promise<SqlJsStatic> | null = null;
function sqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: (file) => (file.endsWith('.wasm') ? wasmUrl : file) });
  return sqlPromise;
}

/** Open the SQLite bytes and plan an import. Does not modify anything. */
export async function readThingsDatabase(bytes: Uint8Array): Promise<ThingsImport> {
  const SQL = await sqlJs();
  let source: Database;
  try {
    source = new SQL.Database(bytes);
  } catch {
    throw new Error('That file is not a readable SQLite database.');
  }
  try {
    return parseThingsDatabase(source);
  } finally {
    source.close();
  }
}

function tableNames(db: Database): Set<string> {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set((res[0]?.values ?? []).map((v) => String(v[0])));
}

function columnsOf(db: Database, table: string): Set<string> {
  const res = db.exec(`PRAGMA table_info("${table}")`);
  return new Set((res[0]?.values ?? []).map((v) => String(v[1])));
}

function rows(db: Database, table: string): ThingsRow[] {
  const res = db.exec(`SELECT * FROM "${table}"`);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => {
    const row: ThingsRow = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = v[i];
    return row;
  });
}

function str(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function num(value: SqlValue | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pick(row: ThingsRow, names: readonly string[]): SqlValue | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

/**
 * Decode a Things date.
 *
 * Current Things releases pack the calendar date into an integer:
 *   (year << 16) | (month << 12) | (day << 7)
 * so 2026-10-15 is 132818816. Older releases stored plain seconds since
 * 2001-01-01 UTC, which is kept as a fallback. Returns a local YYYY-MM-DD.
 */
export function decodeThingsDate(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.trunc(num(value));
  if (n <= 0) return null;

  const year = Math.floor(n / 65536);
  const month = Math.floor(n / 4096) % 16;
  const day = Math.floor(n / 128) % 32;
  if (year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return ymd(d);
  }

  // Seconds since 2001-01-01 (older Things 3 databases).
  const epoch = Date.UTC(2001, 0, 1) + n * 1000;
  const d = new Date(epoch);
  if (d.getUTCFullYear() >= 2001 && d.getUTCFullYear() <= 2200) return ymd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return null;
}

/** Things stores timestamps as Unix seconds (not its 2001-based date format). */
function unixIso(value: SqlValue | undefined): string | null {
  const n = num(value);
  if (n <= 0) return null;
  const ms = n * 1000;
  if (ms < Date.UTC(1970, 0, 1) || ms > Date.UTC(2200, 0, 1)) return null;
  return new Date(ms).toISOString();
}

const byIndex = (a: ThingsRow, b: ThingsRow) => num(a.index) - num(b.index);

/**
 * Map a Things database to OpenThings rows, without writing them.
 *
 * Throws a friendly error when the file isn't a Things database.
 */
export function parseThingsDatabase(db: Database): ThingsImport {
  const tables = tableNames(db);
  if (!tables.has('TMTask') || !tables.has('TMArea')) {
    throw new Error('That database has no Things tables. Choose “main.sqlite” inside “Things Database.thingsdatabase”.');
  }

  const stats = emptyStats();
  const warnings: string[] = [];
  const out: ThingsImport = {
    areas: [],
    projects: [],
    headings: [],
    tasks: [],
    checklist: [],
    tags: [],
    taskTags: [],
    stats,
    warnings,
  };

  const taskCols = columnsOf(db, 'TMTask');
  const col = (name: keyof typeof COL) => COL[name].filter((c) => taskCols.has(c));
  const headingCol = col('heading');
  const deadlineCol = col('deadline');

  // Stable ids so relations survive even if a Things uuid ever collides with one of ours.
  const idMap = new Map<string, string>();
  const idFor = (uuid: string): string => {
    let id = idMap.get(uuid);
    if (!id) {
      id = uuid7();
      idMap.set(uuid, id);
    }
    return id;
  };

  const areaRows = rows(db, 'TMArea').sort(byIndex);
  const areaIds = new Set<string>();
  for (const row of areaRows) {
    const uuid = str(row.uuid);
    if (!uuid) continue;
    const id = idFor(uuid);
    areaIds.add(uuid);
    out.areas.push({ id, name: str(row.title).trim() || 'Untitled area', sort: out.areas.length });
  }

  const allTasks = rows(db, 'TMTask');
  const taskRows = allTasks.filter((row) => num(row.type) !== 1 && num(row.type) !== 2);
  const projectRows = allTasks.filter((row) => num(row.type) === 1);
  const headingRows = allTasks.filter((row) => num(row.type) === 2);

  for (const row of allTasks) if (num(row.trashed) === 1) stats.skippedTrashed++;

  // Projects, including trashed ones, so to-dos can be attributed correctly.
  const projectInfo = new Map<string, { id: string; area: string | null; trashed: boolean }>();
  const projectIds = new Set<string>();
  for (const row of projectRows.sort(byIndex)) {
    const uuid = str(row.uuid);
    if (!uuid) continue;
    const trashed = num(row.trashed) === 1;
    const title = str(row.title).trim();
    if (trashed) {
      projectInfo.set(uuid, { id: '', area: str(row.area) || null, trashed: true });
      continue;
    }
    const id = idFor(uuid);
    const area = str(row.area);
    const status = num(row.status);
    out.projects.push({
      id,
      area_id: area && areaIds.has(area) ? idFor(area) : null,
      name: title || 'Untitled project',
      notes: str(row.notes),
      sort: out.projects.length,
      completed_at: status !== 0 ? (unixIso(row.stopDate) ?? unixIso(row.userModificationDate) ?? new Date().toISOString()) : null,
    });
    projectIds.add(uuid);
    projectInfo.set(uuid, { id, area: area || null, trashed: false });
  }

  // Headings belong to a project.
  const headingIds = new Map<string, { id: string; project: string }>();
  for (const row of headingRows.sort(byIndex)) {
    const uuid = str(row.uuid);
    const parent = str(row.project);
    if (!uuid || num(row.trashed) === 1 || !projectIds.has(parent)) continue;
    const title = str(row.title).trim();
    if (!title) stats.skippedEmpty++;
    const id = idFor(uuid);
    out.headings.push({
      id,
      project_id: idFor(parent),
      name: title || 'Untitled heading',
      sort: out.headings.length,
    });
    headingIds.set(uuid, { id, project: parent });
  }

  // Tags, including nested ones. Things allows a hierarchy; OpenThings tags are
  // flat, so a child keeps its own name (not "Parent/Child").
  const tagIds = new Map<string, string>();
  if (tables.has('TMTag')) {
    const seen = new Map<string, string>();
    for (const row of rows(db, 'TMTag').sort(byIndex)) {
      const uuid = str(row.uuid);
      const name = str(row.title).trim();
      if (!uuid || !name) continue;
      const key = name.toLowerCase();
      let id = seen.get(key);
      if (!id) {
        id = idFor(uuid);
        seen.set(key, id);
        out.tags.push({ id, name });
      } else {
        idMap.set(uuid, id);
      }
      tagIds.set(uuid, id);
    }
  }

  const taskIds = new Set<string>();
  for (const row of taskRows.sort(byIndex)) {
    const uuid = str(row.uuid);
    if (!uuid || num(row.trashed) === 1) continue;
    if (num(row.type) !== 0) continue;

    const title = str(row.title).trim();
    if (!title) {
      stats.skippedEmpty++;
      continue;
    }

    const rawProject = str(row.project);
    const project = rawProject ? projectInfo.get(rawProject) : undefined;
    if (rawProject && project?.trashed) {
      stats.skippedOrphans++;
      continue;
    }

    const rawHeading = headingCol.length ? str(pick(row, headingCol)) : '';
    const heading = rawHeading ? headingIds.get(rawHeading) : undefined;
    // Headings always belong to a project; use it when a to-do doesn't name one.
    const projectId = project?.id ?? (heading ? idFor(heading.project) : null);

    // A to-do in a project is shown through that project; only loose to-dos carry area_id.
    const rawArea = str(row.area);
    const areaId = !projectId && rawArea && areaIds.has(rawArea) ? idFor(rawArea) : null;

    const status = num(row.status);
    const completed = status === 3 || status === 2;
    if (status === 2) stats.canceled++;
    if (status === 3) stats.completed++;
    if (status === 0) stats.open++;

    const startDate = decodeThingsDate(row.startDate);
    const someday = num(row.start) === 2;
    const deadline = deadlineCol.length ? decodeThingsDate(pick(row, deadlineCol)) : null;
    const repeating = row.rt1_recurrenceRule != null || row.repeater != null || str(row.rt1_repeatingTemplate) !== '';
    if (repeating) stats.repeating++;
    if (num(row.reminderTime) > 0) stats.reminders++;

    const id = idFor(uuid);
    taskIds.add(uuid);
    out.tasks.push({
      id,
      title,
      notes: str(row.notes),
      project_id: projectId,
      area_id: areaId,
      heading_id: heading && (!rawProject || heading.project === rawProject) ? heading.id : null,
      when_date: someday ? null : startDate,
      evening: 0,
      someday: someday ? 1 : 0,
      deadline,
      completed_at: completed ? (unixIso(row.stopDate) ?? unixIso(row.userModificationDate) ?? new Date().toISOString()) : null,
      created_at: unixIso(row.creationDate) ?? new Date().toISOString(),
      sort: num(row.index),
      urgent: 0,
      important: 0,
      estimate_min: null,
      rrule: null,
      dump: 0,
      dump_section_id: null,
      deleted_at: null,
      reminder_at: null,
      reminder_sent_at: null,
    });
  }
  stats.todos = out.tasks.length;

  if (tables.has('TMTaskTag') && tagIds.size) {
    const seen = new Set<string>();
    for (const row of rows(db, 'TMTaskTag')) {
      const task = str(row.tasks);
      const tag = str(row.tags);
      const taskId = task && taskIds.has(task) ? idMap.get(task) : undefined;
      const tagId = tag ? tagIds.get(tag) : undefined;
      if (!taskId || !tagId) continue;
      const key = `${taskId}:${tagId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.taskTags.push({ id: uuid7(), task_id: taskId, tag_id: tagId });
    }
  }
  stats.taskTags = out.taskTags.length;
  stats.tags = out.tags.length;
  stats.areas = out.areas.length;
  stats.projects = out.projects.length;
  stats.headings = out.headings.length;

  if (tables.has('TMChecklistItem')) {
    for (const row of rows(db, 'TMChecklistItem').sort(byIndex)) {
      const task = str(row.task);
      const uuid = str(row.uuid);
      const taskId = task && taskIds.has(task) ? idMap.get(task) : undefined;
      const title = str(row.title).trim();
      if (!uuid || !taskId || !title) continue;
      out.checklist.push({
        id: idFor(uuid),
        task_id: taskId,
        title,
        done: num(row.status) === 3 ? 1 : 0,
        sort: out.checklist.length,
      });
    }
  }
  stats.checklist = out.checklist.length;

  if (stats.repeating) {
    warnings.push(`${stats.repeating} repeating to-do${stats.repeating === 1 ? '' : 's'} came across as single to-dos. Repeat rules aren't imported.`);
  }
  if (stats.reminders) {
    warnings.push(`${stats.reminders} Things reminder${stats.reminders === 1 ? '' : 's'} were left behind; re-add them with A or %time in quick add.`);
  }
  if (stats.canceled) {
    warnings.push(`${stats.canceled} canceled to-do${stats.canceled === 1 ? '' : 's'} were imported as completed.`);
  }
  if (stats.skippedTrashed) {
    warnings.push(`${stats.skippedTrashed} item${stats.skippedTrashed === 1 ? '' : 's'} in the Things Trash ${stats.skippedTrashed === 1 ? 'was' : 'were'} not imported.`);
  }
  if (stats.skippedOrphans) {
    warnings.push(`${stats.skippedOrphans} to-do${stats.skippedOrphans === 1 ? '' : 's'} inside a trashed project ${stats.skippedOrphans === 1 ? 'was' : 'were'} not imported.`);
  }

  return out;
}
