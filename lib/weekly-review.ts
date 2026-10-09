import type {
  WorkHealth,
  WorkItemActivityType,
  WorkPriority,
  WorkStatus,
} from './work-items';

const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;
const DAY_MILLISECONDS = 86_400_000;

export type WeeklyReviewCategory =
  | 'created'
  | 'completion'
  | 'workflow'
  | 'comment'
  | 'edited'
  | 'lifecycle';

export type WeeklyReviewEvent = {
  id: string;
  workItemId: string;
  workItemTitle: string;
  type: WorkItemActivityType;
  authorUserId: string | null;
  authorName: string;
  body: string;
  checklistStepId: string | null;
  checklistTitle: string | null;
  createdAt: string;
  team: string;
  owner: string;
  priority: WorkPriority;
  status: WorkStatus;
  health: WorkHealth;
  progress: number;
  archivedAt: string | null;
};

export type WeeklyReviewSnapshot = {
  week: string;
  start: string;
  end: string;
  events: WeeklyReviewEvent[];
  truncated: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function weekMonday(year: number, week: number) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const day = januaryFourth.getUTCDay() || 7;
  return new Date(Date.UTC(year, 0, 4 - day + 1 + ((week - 1) * 7)));
}

function isoWeekFromUtcDate(date: Date) {
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const year = target.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil((((target.getTime() - yearStart) / DAY_MILLISECONDS) + 1) / 7);
  return `${year}-W${pad(week)}`;
}

export function parseIsoWeek(value: string) {
  const match = WEEK_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (year < 2000 || year > 2200 || week < 1 || week > 53) return null;
  const monday = weekMonday(year, week);
  return isoWeekFromUtcDate(monday) === value ? { year, week, monday } : null;
}

export function isoWeekForDate(date: Date) {
  const localCalendarDate = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ));
  return isoWeekFromUtcDate(localCalendarDate);
}

export function isoWeekCalendarRange(value: string) {
  const parsed = parseIsoWeek(value);
  if (!parsed) return null;
  const end = new Date(parsed.monday.getTime() + (7 * DAY_MILLISECONDS));
  return {
    startDate: parsed.monday.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function isoWeekRange(value: string, timezoneOffsetMinutes: number) {
  const calendar = isoWeekCalendarRange(value);
  if (!calendar || !Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
    return null;
  }
  const start = new Date(`${calendar.startDate}T00:00:00.000Z`);
  start.setUTCMinutes(start.getUTCMinutes() + timezoneOffsetMinutes);
  const end = new Date(start.getTime() + (7 * DAY_MILLISECONDS));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function shiftIsoWeek(value: string, weeks: number) {
  const parsed = parseIsoWeek(value);
  if (!parsed || !Number.isInteger(weeks)) return value;
  return isoWeekFromUtcDate(new Date(parsed.monday.getTime() + (weeks * 7 * DAY_MILLISECONDS)));
}

export function formatIsoWeekRange(value: string) {
  const parsed = parseIsoWeek(value);
  if (!parsed) return value;
  const sunday = new Date(parsed.monday.getTime() + (6 * DAY_MILLISECONDS));
  const start = new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(parsed.monday);
  const end = new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(sunday);
  return `${start} – ${end}`;
}

export function classifyWeeklyReviewEvent(event: WeeklyReviewEvent): WeeklyReviewCategory {
  if (event.type === 'created') return 'created';
  if (event.type === 'comment') return 'comment';
  if (event.type === 'checklist' && /\bto done\b/i.test(event.body)) return 'completion';
  if (event.type === 'workflow') return 'workflow';
  if (event.type === 'archived' || event.type === 'restored') return 'lifecycle';
  return 'edited';
}
