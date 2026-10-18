/** Demo data for a fresh install. */
import { insert, uuid7 } from './db';
import { addDays, today } from './dates';

export function seed() {
  const day = today();
  const now = Date.now();
  let sort = 1;
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const H = 3600_000;

  const area = (name: string) => {
    const id = uuid7();
    insert('areas', { id, name, sort: sort++ });
    return id;
  };
  const project = (name: string, area_id: string | null, notes = '') => {
    const id = uuid7();
    insert('projects', { id, area_id, name, notes, sort: sort++, completed_at: null });
    return id;
  };
  const heading = (project_id: string, name: string) => {
    const id = uuid7();
    insert('headings', { id, project_id, name, sort: sort++ });
    return id;
  };
  const tagIds = new Map<string, string>();
  const tag = (name: string) => {
    if (!tagIds.has(name)) {
      const id = uuid7();
      insert('tags', { id, name });
      tagIds.set(name, id);
    }
    return tagIds.get(name)!;
  };
  const task = (title: string, f: Record<string, string | number | null> = {}, tags: string[] = []) => {
    const id = uuid7();
    insert('tasks', {
      id,
      title,
      notes: '',
      project_id: null,
      area_id: null,
      heading_id: null,
      when_date: null,
      evening: 0,
      someday: 0,
      deadline: null,
      completed_at: null,
      created_at: iso(0),
      sort: sort++,
      urgent: 0,
      important: 0,
      estimate_min: null,
      rrule: null,
      dump: 0,
      dump_section_id: null,
      ...f,
    });
    for (const t of tags) insert('task_tags', { id: uuid7(), task_id: id, tag_id: tag(t) });
    return id;
  };

  const home = area('Home');
  const work = area('Work');
  const health = area('Health');

  const launch = project('Launch storefront', work, 'Ship the new shop before the holiday rush.');
  const design = heading(launch, 'Design');
  const build = heading(launch, 'Build');
  const garage = project('Garage cleanout', home);
  const meetup = project('Linux meetup', work);

  // Inbox
  task('Look into label printer firmware update');
  task('Reply to vendor about filament pricing', { urgent: 1 });

  // Today
  const t1 = task('Write product descriptions', { project_id: launch, heading_id: design, when_date: day, important: 1, urgent: 1, estimate_min: 45 }, ['writing']);
  task('Pick up packing tape', { area_id: home, when_date: day, urgent: 1 }, ['errand']);
  task('Review homelab backups', { when_date: addDays(day, -2), important: 1 });
  task('Book venue for meetup', { project_id: meetup, deadline: day, important: 1, urgent: 1 });
  const eightPm = new Date();
  eightPm.setHours(20, 0, 0, 0);
  task('Read a chapter', { area_id: health, when_date: day, evening: 1, reminder_at: eightPm.toISOString() });
  task('Plan tomorrow', { when_date: day, evening: 1, rrule: 'FREQ=DAILY;INTERVAL=1' });

  // Checklist on the first task
  for (const [i, c] of ['Hero product', 'Accessories', 'Digital downloads'].entries()) {
    insert('checklist', { id: uuid7(), task_id: t1, title: c, done: i === 0 ? 1 : 0, sort: i });
  }

  // Upcoming
  task('Photograph new products', { project_id: launch, heading_id: design, when_date: addDays(day, 1), estimate_min: 90 });
  task('Set up payment provider', { project_id: launch, heading_id: build, when_date: addDays(day, 2), important: 1 });
  task('Donate old shelving', { project_id: garage, when_date: addDays(day, 4) });
  task('Weekly review', { when_date: addDays(day, 6), rrule: 'FREQ=WEEKLY;INTERVAL=1', important: 1 });
  task('Post meetup announcement', { project_id: meetup, when_date: addDays(day, 9), deadline: addDays(day, 12) });

  // Anytime
  task('Configure shipping zones', { project_id: launch, heading_id: build });
  task('Write refund policy', { project_id: launch, heading_id: build });
  task('Sort hardware bins', { project_id: garage });
  task('Hang pegboard', { project_id: garage }, ['weekend']);
  task('Schedule dentist', { area_id: health });

  // Someday
  task('Learn KiCad', { someday: 1 });
  task('Build a split keyboard', { someday: 1 }, ['maker']);

  // Logbook
  task('Order shipping boxes', { project_id: launch, completed_at: iso(3 * H) });
  task('Clear garage floor', { project_id: garage, completed_at: iso(26 * H) });

  // Brain dump — ages chosen to show the fade.
  const ideas = uuid7();
  insert('dump_sections', { id: ideas, name: 'Ideas', sort: 1 });
  const errands = uuid7();
  insert('dump_sections', { id: errands, name: 'Errands', sort: 2 });
  task('why does the NAS fan spin up at 3am?', { dump: 1, created_at: iso(0.5 * H) });
  task('call mom back', { dump: 1, created_at: iso(5 * H) });
  task('sticker of a stegosaurus wearing headphones', { dump: 1, dump_section_id: ideas, created_at: iso(2 * H) });
  task('fridge magnet that holds a pen', { dump: 1, dump_section_id: ideas, created_at: iso(30 * H) });
  task('batteries (AA)', { dump: 1, dump_section_id: errands, created_at: iso(12 * H) });
  task('return library book', { dump: 1, dump_section_id: errands, created_at: iso(44 * H) });

  // Habits with some history
  const habits = ['Read 20 minutes', 'Walk outside', 'Journal', 'No phone after 9pm'];
  habits.forEach((name, i) => {
    const id = uuid7();
    // "No phone after 9pm" is a 75-day challenge, two weeks in.
    const challenge = i === 3 ? { target_days: 75, start_date: addDays(day, -14) } : { target_days: null, start_date: null };
    insert('habits', { id, name, sort: i, created_at: iso(30 * 24 * H), ...challenge });
    for (let d = 1; d < 21; d++) {
      // Deterministic pseudo-history.
      if ((d * (i + 3)) % 5 !== 0 && !(i === 2 && d > 6)) insert('habit_checks', { id: uuid7(), habit_id: id, day: addDays(day, -d) });
    }
  });
}
