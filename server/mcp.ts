/**
 * MCP server over Streamable HTTP, stateless: each POST /mcp carries JSON-RPC and gets a JSON reply.
 * No sessions and no server-initiated messages, so GET (SSE) is not offered. Tools call the same
 * Service as the REST API, so every change goes through the op log and syncs to devices.
 */
import { Service, UserError, VIEWS, type TaskOut } from './service';

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const QUICK_ADD_HELP =
  'Quick-add syntax (same as the app): #tag, +Project (hyphens for spaces), @today @tonight @tomorrow @fri @someday @2026-11-02 (when), ' +
  '!fri (deadline), %9am or %fri-9am (reminder), *daily *weekly *weekdays *2w *mon,thu *1st,15th *last-fri (repeat), ~30m (estimate), ^u ^i (urgent / important), ' +
  '@dump (brain dump), and "title // notes".';

type Json = Record<string, unknown>;
type Props = Record<string, Json>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Props; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (s: Service, a: Json) => unknown;
}

const str = (description: string): Json => ({ type: 'string', description });
const bool = (description: string): Json => ({ type: 'boolean', description });
const strOrNull = (description: string): Json => ({ type: ['string', 'null'], description });
const tagList = (description: string): Json => ({ type: 'array', items: { type: 'string' }, description });

const WHEN = 'today, tonight, tomorrow, a weekday (fri), next-week, in3d, someday, anytime, inbox, or YYYY-MM-DD. null clears it.';

/** Short task form for assistants: drops empty fields and internal columns. */
export function compact(t: TaskOut): Json {
  const out: Json = { id: t.id, title: t.title };
  if (t.notes) out.notes = t.notes;
  if (t.completed_at) out.completed_at = t.completed_at;
  if (t.deleted_at) out.in_trash = true;
  if (t.when_date) out.when = t.when_date;
  if (t.evening) out.evening = true;
  if (t.someday) out.someday = true;
  if (t.deadline) out.deadline = t.deadline;
  if (t.project) out.project = t.project;
  if (t.area) out.area = t.area;
  if (t.tags.length) out.tags = t.tags;
  if (t.reminder_at) out.reminder = t.reminder_at;
  if (t.repeat) out.repeat = t.repeat;
  if (t.urgent) out.urgent = true;
  if (t.important) out.important = true;
  if (t.estimate_min) out.estimate_min = t.estimate_min;
  if (t.dump) out.brain_dump = true;
  if (t.checklist.length) out.checklist = t.checklist;
  if (t.group) out.group = t.group;
  return out;
}

const id = (a: Json) => {
  if (typeof a.id !== 'string' || !a.id) throw new UserError('"id" is required');
  return a.id;
};
const opt = <T>(a: Json, k: string): T | undefined => (k in a ? (a[k] as T) : undefined);

export const TOOLS: Tool[] = [
  {
    name: 'list_tasks',
    title: 'List to-dos',
    description:
      `List to-dos in a view, as the app shows them. Views: ${VIEWS.join(', ')}. Default is today (overdue items included; "group": "evening" marks This Evening). ` +
      'upcoming and week group by date; matrix groups by Eisenhower quadrant. Narrow with project, area or tag (then the default view is all open to-dos).',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...VIEWS], description: 'Which list (default today)' },
        project: str('Project name or id'),
        area: str('Area name or id'),
        tag: str('Tag name'),
        include_completed: bool('With view "all": include completed to-dos'),
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum number of to-dos' },
      },
    },
    annotations: { readOnlyHint: true },
    run: (s, a) => {
      const tasks = s.list({ view: opt(a, 'view'), project: opt(a, 'project'), area: opt(a, 'area'), tag: opt(a, 'tag'), include_completed: opt(a, 'include_completed'), limit: opt(a, 'limit') });
      return { today: s.today(), count: tasks.length, tasks: tasks.map(compact) };
    },
  },
  {
    name: 'search_tasks',
    title: 'Search to-dos',
    description: 'Find to-dos whose title or notes contain every word of the query. Open ones first, newest first.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Words to look for'), include_completed: bool('Include completed to-dos'), limit: { type: 'integer', minimum: 1, maximum: 200 } },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    run: (s, a) => s.search(String(a.query ?? ''), { include_completed: opt(a, 'include_completed'), limit: opt(a, 'limit') }).map(compact),
  },
  {
    name: 'get_task',
    title: 'Get a to-do',
    description: 'One to-do with its notes, tags, checklist, dates and reminder.',
    inputSchema: { type: 'object', properties: { id: str('To-do id') }, required: ['id'] },
    annotations: { readOnlyHint: true },
    run: (s, a) => compact(s.getTask(id(a))),
  },
  {
    name: 'add_task',
    title: 'Add a to-do',
    description: `Create a to-do. ${QUICK_ADD_HELP} Without a when or project it goes to the Inbox. Unknown +Project names create a project. Optional fields override the text.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: str('Title with optional quick-add tokens, e.g. "Call dentist +Health @fri %9am #phone"'),
        notes: str('Notes'),
        when: strOrNull(WHEN),
        deadline: strOrNull('Deadline: a day word or YYYY-MM-DD'),
        reminder: strOrNull('Reminder: "9am", "fri 9am", "in 30m", or an ISO timestamp'),
        repeat: strOrNull('daily, weekly, monthly, yearly, weekdays, 2d, 3w, mon,thu, 2w-mon,thu, 1st,15th, last-day, 2nd-tue, last-fri, or an RRULE like FREQ=MONTHLY;BYDAY=-1FR'),
        project: str('Existing project name or id'),
        area: str('Existing area name or id'),
        tags: tagList('Tag names'),
      },
      required: ['text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (s, a) => compact(s.addTask(a as never)),
  },
  {
    name: 'update_task',
    title: 'Update a to-do',
    description: 'Change a to-do. Only the fields you pass change; null clears a date or reminder. "tags" replaces all tags; add_tags / remove_tags edit them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('To-do id'),
        title: str('New title (no quick-add parsing)'),
        notes: str('New notes (replaces the old ones)'),
        when: strOrNull(WHEN),
        deadline: strOrNull('Deadline: a day word or YYYY-MM-DD'),
        reminder: strOrNull('Reminder: "9am", "fri 9am", "in 30m", or an ISO timestamp'),
        repeat: strOrNull('daily, weekly, weekdays, 2w, mon,thu, 1st,15th, last-fri, or an RRULE (FREQ=…); null stops repeating'),
        tags: tagList('Replace all tags'),
        add_tags: tagList('Tags to add'),
        remove_tags: tagList('Tags to remove'),
        urgent: bool('Eisenhower: urgent'),
        important: bool('Eisenhower: important'),
        estimate_min: { type: ['integer', 'null'], minimum: 0, description: 'Time estimate in minutes' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s, a) => {
      const { id: _id, ...fields } = a;
      return compact(s.updateTask(id(a), fields as never));
    },
  },
  {
    name: 'complete_task',
    title: 'Complete a to-do',
    description: 'Check off a to-do (it moves to the Logbook). A repeating to-do schedules its next occurrence. undo: true un-checks it.',
    inputSchema: { type: 'object', properties: { id: str('To-do id'), undo: bool('Mark it not done again') }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s, a) => {
      if (a.undo) return compact(s.uncompleteTask(id(a)));
      const { task, next } = s.completeTask(id(a));
      return next ? { completed: compact(task), next: compact(next) } : { completed: compact(task) };
    },
  },
  {
    name: 'move_task',
    title: 'Move a to-do',
    description: 'Move a to-do to a project, an area, the Inbox, or the Brain Dump. Moving out of the Brain Dump makes it permanent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('To-do id'),
        project: str('Project name or id'),
        area: str('Area name or id'),
        inbox: bool('Move to the Inbox (also clears its date)'),
        dump: bool('Move to the Brain Dump'),
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s, a) => compact(s.moveTask(id(a), a as never)),
  },
  {
    name: 'delete_task',
    title: 'Move a to-do to the Trash',
    description: 'Move a to-do to the Trash; it can be restored for 30 days. restore: true takes it back out.',
    inputSchema: { type: 'object', properties: { id: str('To-do id'), restore: bool('Restore from the Trash instead') }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: (s, a) => compact(a.restore ? s.restoreTask(id(a)) : s.trashTask(id(a))),
  },
  {
    name: 'brain_dump',
    title: 'Brain dump',
    description: 'Capture a thought into the Brain Dump. Unchecked items there are deleted for good after 48 hours unless moved to a list.',
    inputSchema: { type: 'object', properties: { text: str('What to capture'), section: str('Brain Dump section name (created if new)') }, required: ['text'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (s, a) => compact(s.addTask({ title: String(a.text ?? ''), dump: true, dump_section: opt(a, 'section') ?? null })),
  },
  {
    name: 'add_checklist_item',
    title: 'Add a checklist item',
    description: 'Add an item to a to-do\'s checklist.',
    inputSchema: { type: 'object', properties: { task_id: str('To-do id'), title: str('Item text') }, required: ['task_id', 'title'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (s, a) => compact(s.addChecklistItem(String(a.task_id ?? ''), String(a.title ?? ''))),
  },
  {
    name: 'check_checklist_item',
    title: 'Check a checklist item',
    description: 'Check (or un-check) a checklist item by its id (from get_task).',
    inputSchema: { type: 'object', properties: { id: str('Checklist item id'), done: bool('true to check (default), false to un-check') }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s, a) => compact(s.setChecklistItem(id(a), a.done !== false)),
  },
  {
    name: 'list_projects',
    title: 'List projects, areas and tags',
    description: 'The structure of the to-do list: areas, projects (with open to-do counts) and tags.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (s) => ({
      areas: s.areas().map((a) => ({ id: a.id, name: a.name })),
      projects: s.projects().map((p) => ({ id: p.id, name: p.name, area: p.area, open: p.open, ...(p.completed_at ? { completed_at: p.completed_at } : {}) })),
      tags: s.tags().map((t) => ({ name: t.name, open: t.open })),
    }),
  },
  {
    name: 'add_project',
    title: 'Add a project',
    description: 'Create a project, optionally inside an area.',
    inputSchema: { type: 'object', properties: { name: str('Project name'), area: str('Area name or id') }, required: ['name'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (s, a) => s.addProject(String(a.name ?? ''), opt(a, 'area')),
  },
  {
    name: 'list_habits',
    title: 'List habits',
    description: 'Habits with today\'s check-in, streak, schedule and the last two weeks of check-ins.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (s) =>
      s.habits().map((h) => ({
        id: h.id,
        name: h.name,
        schedule: h.schedule_label,
        due_today: h.due_today,
        checked_today: h.checked_today,
        streak: `${h.streak} ${h.streak_unit}${h.streak === 1 ? '' : 's'}`,
        ...(h.target_days ? { challenge: `${h.target_days} days from ${h.start_date}` } : {}),
        recent: h.recent,
      })),
  },
  {
    name: 'check_habit',
    title: 'Check in a habit',
    description: 'Check in a habit for today or another day. undo: true removes the check-in.',
    inputSchema: {
      type: 'object',
      properties: { habit: str('Habit name or id'), day: str('today (default), yesterday, or YYYY-MM-DD'), undo: bool('Remove the check-in') },
      required: ['habit'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s, a) => {
      const h = s.checkHabit(String(a.habit ?? ''), { day: opt(a, 'day'), done: !a.undo });
      return { habit: h.name, day: h.day, checked: !a.undo, streak: `${h.streak} ${h.streak_unit}${h.streak === 1 ? '' : 's'}` };
    },
  },
  {
    name: 'start_timer',
    title: 'Start a timer',
    description: 'Start tracking time on a to-do. Stops any running timer first.',
    inputSchema: { type: 'object', properties: { task_id: str('To-do id') }, required: ['task_id'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (s, a) => {
      const t = s.startTimer(String(a.task_id ?? ''));
      return { tracking: t.task?.title, since: t.entry.start_at };
    },
  },
  {
    name: 'stop_timer',
    title: 'Stop the timer',
    description: 'Stop the running timer, if any, and report the time tracked.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (s) => {
      const r = s.stopTimer();
      return r ? { stopped: true, minutes: r.minutes, task_id: r.entry.task_id } : { stopped: false, message: 'No timer was running' };
    },
  },
  {
    name: 'current_timer',
    title: 'Current timer',
    description: 'What is being tracked right now, if anything.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (s) => {
      const t = s.timer();
      return t ? { tracking: t.task?.title, task_id: t.entry.task_id, since: t.entry.start_at, elapsed_min: t.elapsed_min } : { tracking: null };
    },
  },
];

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Json;
}

const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function handleRpc(service: Service, msg: unknown, version: string): object | null {
  if (!msg || typeof msg !== 'object' || (msg as RpcRequest).jsonrpc !== '2.0' || typeof (msg as RpcRequest).method !== 'string') {
    return rpcError((msg as RpcRequest)?.id ?? null, -32600, 'Invalid JSON-RPC request');
  }
  const req = msg as RpcRequest;
  const isNotification = !('id' in req);
  const ok = (result: object) => (isNotification ? null : { jsonrpc: '2.0', id: req.id, result });

  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'openthings', title: 'OpenThings', version },
        instructions:
          'OpenThings is the user\'s to-do list (areas, projects, to-dos with When and Deadline dates, tags, habits, time tracking). ' +
          `Today is ${service.today()} in the server's time zone. Use list_tasks to see a list, add_task to capture (supports quick-add syntax), ` +
          'and complete_task to check things off. Changes sync to all of the user\'s devices.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      const args = (req.params?.arguments ?? {}) as Json;
      try {
        const result = tool.run(service, args);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] });
      } catch (e) {
        if (e instanceof UserError) return ok({ content: [{ type: 'text', text: e.message }], isError: true });
        console.error(`MCP ${name} failed`, e);
        return ok({ content: [{ type: 'text', text: `Internal error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, notifications/cancelled…
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}
