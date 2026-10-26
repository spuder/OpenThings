import { describe, expect, it } from 'vitest';
import { describeRule, firstOccurrence, nextOccurrence, nextRepeat, parseQuickAdd, parseRepeat, pinRepeat } from './parse';
import { formatRule, ordinal, parseRule, position, previewDates } from './rrule';

// 2026-10-18 is a Sunday. October 2026 starts on a Thursday; November on a Sunday.
const REF = '2026-10-18';
const rule = (s: string) => {
  const r = parseRule(s);
  if (!r) throw new Error(`bad rule ${s}`);
  return r;
};

describe('parseRule / formatRule', () => {
  it('reads every supported part', () => {
    expect(parseRule('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1FR;BYMONTHDAY=1,-1;BYMONTH=3,9;BYSETPOS=-1;COUNT=4;UNTIL=20271231T235959Z')).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [{ day: 2, n: 2 }, { day: 5, n: -1 }],
      byMonthDay: [1, -1],
      byMonth: [3, 9],
      bySetPos: [-1],
      count: 4,
      until: '2027-12-31',
    });
  });
  it('defaults INTERVAL to 1, ignores WKST and case', () => {
    expect(parseRule('freq=weekly;byday=mo,th;wkst=MO')).toMatchObject({ freq: 'WEEKLY', interval: 1, byDay: [{ day: 1, n: 0 }, { day: 4, n: 0 }] });
  });
  it('rejects rules it cannot schedule', () => {
    for (const bad of ['', 'FREQ=HOURLY', 'INTERVAL=2', 'FREQ=DAILY;INTERVAL=0', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=MONTHLY;BYMONTHDAY=0', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=MONTHLY;BYDAY=6MO', 'FREQ=DAILY;COUNT=0', 'FREQ=DAILY;UNTIL=soon', 'FREQ']) {
      expect(parseRule(bad), bad).toBeNull();
    }
  });
  it('writes a canonical, sorted form that reads back the same', () => {
    const text = formatRule(rule('FREQ=WEEKLY;BYDAY=TH,MO,SU,MO;INTERVAL=2;UNTIL=2026-12-31;COUNT=3'));
    expect(text).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH,SU;COUNT=3;UNTIL=20261231');
    expect(formatRule(rule(text))).toBe(text);
    expect(formatRule(rule('FREQ=MONTHLY;BYMONTHDAY=-1,15,1,-2'))).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15,-2,-1');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
    expect([-1, -2, 3].map(position)).toEqual(['last', '2nd to last', '3rd']);
  });
});

describe('nextOccurrence: daily and weekly', () => {
  it('keeps the existing simple rules', () => {
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=1', REF)).toBe('2026-10-19');
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=3', REF)).toBe('2026-10-21');
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=1', REF)).toBe('2026-10-25');
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=3', REF)).toBe('2026-11-08');
    expect(nextOccurrence('FREQ=YEARLY;INTERVAL=1', REF)).toBe('2027-10-18');
  });
  it('weekdays skip the weekend (legacy text without INTERVAL)', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-23')).toBe('2026-10-26');
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-24')).toBe('2026-10-26');
  });
  it('BYDAY lists step through the week', () => {
    const r = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH';
    expect(nextOccurrence(r, '2026-10-18')).toBe('2026-10-19');
    expect(nextOccurrence(r, '2026-10-19')).toBe('2026-10-22');
    expect(nextOccurrence(r, '2026-10-22')).toBe('2026-10-26');
  });
  it('INTERVAL skips whole weeks after the last day of an active week (weeks start Monday)', () => {
    const r = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH';
    expect(nextOccurrence(r, '2026-10-19')).toBe('2026-10-22');
    expect(nextOccurrence(r, '2026-10-22')).toBe('2026-11-02');
    // Sunday ends the week: Sunday's own week is active, so the next Monday is off.
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU', '2026-10-18', '2026-10-18')).toBe('2026-10-26');
  });
  it('counts periods from the anchor when a to-do is checked off late', () => {
    // Every 2 weeks on Monday, due Mon Oct 5, checked off Wed Oct 14: stays on its weeks.
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-10-14', '2026-10-05')).toBe('2026-10-19');
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=3', '2026-10-14', '2026-10-05')).toBe('2026-10-17');
    // Without an anchor the checked-off day starts the count.
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-10-14')).toBe('2026-10-26');
  });
  it('daily rules can be limited to weekdays', () => {
    expect(nextOccurrence('FREQ=DAILY;BYDAY=SA,SU', '2026-10-19')).toBe('2026-10-24');
  });
  it('weekly rules can be limited to months', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYMONTH=1;BYDAY=MO', '2026-01-25')).toBe('2026-01-26');
    expect(nextOccurrence('FREQ=WEEKLY;BYMONTH=1;BYDAY=MO', '2026-01-26')).toBe('2027-01-04');
  });
});

describe('nextOccurrence: monthly', () => {
  it('BYMONTHDAY lists', () => {
    const r = 'FREQ=MONTHLY;BYMONTHDAY=1,15';
    expect(nextOccurrence(r, REF)).toBe('2026-11-01');
    expect(nextOccurrence(r, '2026-11-01')).toBe('2026-11-15');
    expect(nextOccurrence(r, '2026-11-15')).toBe('2026-12-01');
  });
  it('BYMONTHDAY=-1 is the last day, leap years included', () => {
    const r = 'FREQ=MONTHLY;BYMONTHDAY=-1';
    expect(nextOccurrence(r, REF)).toBe('2026-10-31');
    expect(nextOccurrence(r, '2026-10-31')).toBe('2026-11-30');
    expect(nextOccurrence(r, '2027-01-31')).toBe('2027-02-28');
    expect(nextOccurrence(r, '2028-01-31')).toBe('2028-02-29');
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=-2', '2027-02-01')).toBe('2027-02-27');
  });
  it('a day past the end of a short month lands on its last day, then returns to the day', () => {
    const r = 'FREQ=MONTHLY;BYMONTHDAY=31';
    expect(nextOccurrence(r, '2027-03-31')).toBe('2027-04-30');
    expect(nextOccurrence(r, '2027-04-30')).toBe('2027-05-31');
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=30', '2027-01-30')).toBe('2027-02-28');
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=29,30', '2027-01-30')).toBe('2027-02-28');
  });
  it('plain monthly uses the anchor day and clamps at month end', () => {
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=1', REF)).toBe('2026-11-18');
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=1', '2027-01-31')).toBe('2027-02-28');
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=1', '2028-01-30')).toBe('2028-02-29');
  });
  it('ordinal weekdays: 2nd Tuesday, last Friday, 5th Friday when there is one', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=2TU', REF)).toBe('2026-11-10');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=2TU', '2026-10-01')).toBe('2026-10-13');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=-1FR', REF)).toBe('2026-10-30');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30')).toBe('2026-11-27');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=5FR', '2026-10-30')).toBe('2027-01-29');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=1MO,-1FR', REF)).toBe('2026-10-30');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=1MO,-1FR', '2026-10-30')).toBe('2026-11-02');
  });
  it('BYSETPOS picks from the month’s matching days', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', REF)).toBe('2026-10-30');
    // Last weekday: Oct 31 2026 is a Saturday; Nov 30 a Monday.
    const lastWeekday = 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1';
    expect(nextOccurrence(lastWeekday, REF)).toBe('2026-10-30');
    expect(nextOccurrence(lastWeekday, '2026-10-30')).toBe('2026-11-30');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', '2026-10-30')).toBe('2026-11-02');
  });
  it('BYDAY with BYMONTHDAY intersects (Friday the 13th)', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', REF)).toBe('2026-11-13');
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', '2026-11-13')).toBe('2027-08-13');
  });
  it('INTERVAL counts months from the anchor', () => {
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15', '2026-10-15')).toBe('2026-12-15');
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR', '2026-10-30')).toBe('2027-01-29');
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15', '2026-12-20', '2026-10-15')).toBe('2027-02-15');
  });
});

describe('nextOccurrence: yearly, COUNT and UNTIL', () => {
  it('Feb 29 falls on Feb 28 in common years and comes back in leap years', () => {
    const r = 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29';
    expect(nextOccurrence(r, '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(r, '2031-02-28')).toBe('2032-02-29');
  });
  it('yearly on an ordinal weekday of a month', () => {
    // 4th Thursday of November: Nov 26 2026, Nov 25 2027.
    expect(nextOccurrence('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', REF)).toBe('2026-11-26');
    expect(nextOccurrence('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-11-26')).toBe('2027-11-25');
  });
  it('yearly month days and weekdays apply across the year without BYMONTH', () => {
    expect(nextOccurrence('FREQ=YEARLY;BYMONTHDAY=1', REF)).toBe('2026-11-01');
    expect(nextOccurrence('FREQ=YEARLY;BYDAY=MO', REF)).toBe('2026-10-19');
    expect(nextOccurrence('FREQ=YEARLY;BYDAY=1MO', REF)).toBe('2027-01-04');
  });
  it('COUNT is what is left: the last one has no next', () => {
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', REF)).toBeNull();
    expect(nextOccurrence('FREQ=DAILY;COUNT=2', REF)).toBe('2026-10-19');
    expect(nextRepeat('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3', REF)).toEqual({ date: '2026-10-19', rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=2' });
    expect(nextRepeat('FREQ=WEEKLY;INTERVAL=1;COUNT=1', REF)).toBeNull();
  });
  it('UNTIL is inclusive', () => {
    const r = 'FREQ=WEEKLY;UNTIL=20261025';
    expect(nextOccurrence(r, REF)).toBe('2026-10-25');
    expect(nextOccurrence(r, '2026-10-25')).toBeNull();
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=-1FR;UNTIL=2026-11-26', '2026-10-30')).toBeNull();
  });
  it('nextRepeat keeps the stored text when nothing counts down', () => {
    expect(nextRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-23')).toEqual({ date: '2026-10-26', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  });
  it('unreadable rules have no next occurrence', () => {
    expect(nextOccurrence('nonsense', REF)).toBeNull();
    expect(nextRepeat('FREQ=SECONDLY', REF)).toBeNull();
  });
});

describe('firstOccurrence and previewDates', () => {
  it('starts on the first matching day, which may be the start itself', () => {
    expect(firstOccurrence('FREQ=WEEKLY;BYDAY=MO,TH', REF)).toBe('2026-10-19');
    expect(firstOccurrence('FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-22')).toBe('2026-10-22');
    expect(firstOccurrence('FREQ=MONTHLY;BYDAY=-1FR', REF)).toBe('2026-10-30');
    expect(firstOccurrence('FREQ=WEEKLY;INTERVAL=1', REF)).toBe(REF);
    expect(firstOccurrence('FREQ=DAILY;UNTIL=20261001', REF)).toBeNull();
  });
  it('previews the series as checking each one off would create it', () => {
    expect(previewDates(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'), REF, 5)).toEqual(['2026-10-19', '2026-10-22', '2026-11-02', '2026-11-05', '2026-11-16']);
    expect(previewDates(rule('FREQ=MONTHLY;BYDAY=-1FR'), REF, 3)).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });
  it('stops at COUNT and UNTIL', () => {
    expect(previewDates(rule('FREQ=DAILY;COUNT=3'), REF, 5)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20']);
    expect(previewDates(rule('FREQ=WEEKLY;UNTIL=20261101'), REF, 5)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01']);
  });
});

describe('pinRepeat', () => {
  it('pins monthly rules that start on the 29th–31st so they do not drift', () => {
    expect(pinRepeat('FREQ=MONTHLY;INTERVAL=1', '2027-01-31')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(pinRepeat('FREQ=MONTHLY;INTERVAL=2', '2027-01-30')).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=30');
    expect(pinRepeat('FREQ=YEARLY;INTERVAL=1', '2028-02-29')).toBe('FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=29');
  });
  it('leaves everything else exactly as written', () => {
    for (const r of ['FREQ=MONTHLY;INTERVAL=1', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=YEARLY;INTERVAL=1', 'garbage']) {
      expect(pinRepeat(r, '2026-10-18')).toBe(r);
    }
    expect(pinRepeat('FREQ=MONTHLY;BYMONTHDAY=15', '2027-01-31')).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });
});

describe('describeRule', () => {
  const cases: [string, string][] = [
    ['FREQ=DAILY;INTERVAL=1', 'Daily'],
    ['FREQ=DAILY;INTERVAL=3', 'Every 3 days'],
    ['FREQ=WEEKLY;INTERVAL=1', 'Weekly'],
    ['FREQ=WEEKLY;INTERVAL=2', 'Every 2 weeks'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Weekdays'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', 'Weekends'],
    ['FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA', 'Daily'],
    ['FREQ=WEEKLY;BYDAY=FR', 'Weekly on Friday'],
    ['FREQ=WEEKLY;BYDAY=TH,MO', 'Weekly on Mon, Thu'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', 'Every 2 weeks on Mon, Thu'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR', 'Every 2 weeks on Mon, Tue, Wed, Thu, Fri'],
    ['FREQ=MONTHLY;INTERVAL=1', 'Monthly'],
    ['FREQ=MONTHLY;INTERVAL=6', 'Every 6 months'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Monthly on the last Friday'],
    ['FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', 'Monthly on the last Friday'],
    ['FREQ=MONTHLY;BYDAY=2TU', 'Monthly on the 2nd Tuesday'],
    ['FREQ=MONTHLY;BYDAY=1MO,3MO', 'Monthly on the 1st and 3rd Monday'],
    ['FREQ=MONTHLY;INTERVAL=3;BYDAY=1MO,-1FR', 'Every 3 months on the 1st Monday and last Friday'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'Monthly on the last weekday'],
    ['FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1', 'Monthly on the 1st weekend day'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', 'Monthly on the 1st and 15th'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Monthly on the last day'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1,1', 'Monthly on the 1st and last day'],
    ['FREQ=MONTHLY;BYMONTHDAY=-2', 'Monthly on the 2nd to last day'],
    ['FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', 'Monthly on Friday the 13th'],
    ['FREQ=YEARLY;INTERVAL=1', 'Yearly'],
    ['FREQ=YEARLY;INTERVAL=2', 'Every 2 years'],
    ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', 'Yearly on Feb 29'],
    ['FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', 'Yearly on the 4th Thursday of Nov'],
    ['FREQ=WEEKLY;BYDAY=MO;COUNT=5', 'Weekly on Monday, 5 times'],
    ['FREQ=DAILY;COUNT=1', 'Daily, last time'],
    ['FREQ=WEEKLY;UNTIL=20261231', 'Weekly, until Dec 31'],
    ['FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270115', 'Monthly on the 1st, until Jan 15, 2027'],
    ['not a rule', 'Repeats'],
  ];
  it.each(cases)('%s → %s', (r, label) => {
    expect(describeRule(r, REF)).toBe(label);
  });
});

describe('quick-add repeat syntax', () => {
  it('keeps the existing forms', () => {
    expect(parseRepeat('daily')).toBe('FREQ=DAILY;INTERVAL=1');
    expect(parseRepeat('weekly')).toBe('FREQ=WEEKLY;INTERVAL=1');
    expect(parseRepeat('2d')).toBe('FREQ=DAILY;INTERVAL=2');
    expect(parseRepeat('3w')).toBe('FREQ=WEEKLY;INTERVAL=3');
    expect(parseRepeat('weekdays')).toContain('BYDAY=MO,TU,WE,TH,FR');
    expect(parseRepeat('0d')).toBeNull();
    expect(parseRepeat('blah')).toBeNull();
  });
  it('days of the week', () => {
    expect(parseRepeat('mon,thu')).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH');
    expect(parseRepeat('Friday')).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=FR');
    expect(parseRepeat('2w-tue,thurs')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH');
    expect(parseRepeat('weekends')).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU');
    expect(parseRepeat('mon,xyz')).toBeNull();
  });
  it('days of the month and ordinal weekdays', () => {
    expect(parseRepeat('15th')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15');
    expect(parseRepeat('1st,15th')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15');
    expect(parseRepeat('1st,last')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,-1');
    expect(parseRepeat('last-day')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(parseRepeat('last-fri')).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR');
    expect(parseRepeat('2nd-tue')).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU');
    expect(parseRepeat('first-monday')).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO');
    expect(parseRepeat('last-weekday')).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    expect(parseRepeat('32nd')).toBeNull();
    expect(parseRepeat('6th-mon')).toBeNull();
  });
  it('schedules a new repeating to-do on its first matching day', () => {
    const p = parseQuickAdd('Water plants *mon,thu', REF);
    expect(p.title).toBe('Water plants');
    expect(p.when?.date).toBe('2026-10-19');
    expect(p.tokens.find((t) => t.kind === 'repeat')?.label).toBe('Weekly on Mon, Thu');
    const rent = parseQuickAdd('Pay rent *last-fri', REF);
    expect(rent.when?.date).toBe('2026-10-30');
    expect(rent.tokens.find((t) => t.kind === 'repeat')?.label).toBe('Monthly on the last Friday');
    expect(parseQuickAdd('Invoice *1st,15th', REF).when?.date).toBe('2026-11-01');
    expect(parseQuickAdd('Review *weekly', REF).when?.date).toBe(REF);
  });
  it('an explicit date wins, and pins month-end starts', () => {
    const p = parseQuickAdd('Close the books *monthly @2027-01-31', REF);
    expect(p.when?.date).toBe('2027-01-31');
    expect(p.rrule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(p.tokens.find((t) => t.kind === 'repeat')?.label).toBe('Monthly on the last day');
  });
  it('leaves unknown repeat words in the title', () => {
    expect(parseQuickAdd('Shout *loudly', REF).title).toBe('Shout *loudly');
  });
});
