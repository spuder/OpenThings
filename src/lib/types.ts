export type ID = string;

export interface Area {
  id: ID;
  name: string;
  sort: number;
}

export interface Project {
  id: ID;
  area_id: ID | null;
  name: string;
  notes: string;
  sort: number;
  completed_at: string | null;
}

export interface Heading {
  id: ID;
  project_id: ID;
  name: string;
  sort: number;
}

export interface Task {
  id: ID;
  title: string;
  notes: string;
  project_id: ID | null;
  area_id: ID | null;
  heading_id: ID | null;
  /** Scheduled day, YYYY-MM-DD ("when" in Things). */
  when_date: string | null;
  evening: number;
  someday: number;
  deadline: string | null;
  completed_at: string | null;
  created_at: string;
  sort: number;
  urgent: number;
  important: number;
  estimate_min: number | null;
  /** Simple RRULE, e.g. FREQ=DAILY;INTERVAL=1 */
  rrule: string | null;
  /** 1 = lives in the brain dump and expires 48h after created_at. */
  dump: number;
  dump_section_id: ID | null;
  /** Set when moved to the Trash; purged 30 days later. */
  deleted_at: string | null;
  /** Reminder time, ISO timestamp (UTC). */
  reminder_at: string | null;
  /** When the reminder fired; null = still pending. */
  reminder_sent_at: string | null;
}

export interface ChecklistItem {
  id: ID;
  task_id: ID;
  title: string;
  done: number;
  sort: number;
}

export interface Tag {
  id: ID;
  name: string;
}

export interface TaskTag {
  id: ID;
  task_id: ID;
  tag_id: ID;
}

export interface Habit {
  id: ID;
  name: string;
  sort: number;
  created_at: string;
  /** Challenge length in days (30, 60, 75…); null = open-ended habit. */
  target_days: number | null;
  /** First day of the challenge, YYYY-MM-DD. */
  start_date: string | null;
  /** "daily" | "days:1,2,3,4,5" | "times:5"; null = daily. */
  schedule: string | null;
}

export interface HabitCheck {
  id: ID;
  habit_id: ID;
  day: string;
}

export interface TimeEntry {
  id: ID;
  task_id: ID;
  start_at: string;
  end_at: string | null;
}

export interface DumpSection {
  id: ID;
  name: string;
  sort: number;
}

export type ViewKey =
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'anytime' }
  | { kind: 'someday' }
  | { kind: 'logbook' }
  | { kind: 'dump' }
  | { kind: 'habits' }
  | { kind: 'matrix' }
  | { kind: 'trash' }
  | { kind: 'tag'; id: ID }
  | { kind: 'settings' }
  | { kind: 'project'; id: ID }
  | { kind: 'area'; id: ID };
