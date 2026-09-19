const DAY_MILLISECONDS = 86_400_000;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(parsed) === value ? parsed : null;
}

export function addLocalDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

export function defaultWorkDates(now: Date) {
  return {
    start: localDateKey(now),
    due: localDateKey(addLocalDays(now, 7)),
  };
}

export function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatLiveDateTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDateRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric',
  });
  const endFormatter = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${formatter.format(start)} – ${endFormatter.format(end)}`;
}

export function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

export function calendarDayDifference(fromDateKey: string, toDateKey: string) {
  const from = parseLocalDate(fromDateKey);
  const to = parseLocalDate(toDateKey);
  if (!from || !to) return null;
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY_MILLISECONDS);
}

export function dueCopy(due: string, today: string) {
  const difference = calendarDayDifference(today, due);
  if (difference === null) return `Due ${due}`;
  if (difference < 0) return `${Math.abs(difference)} day${difference === -1 ? '' : 's'} overdue`;
  if (difference === 0) return 'Due today';
  if (difference === 1) return 'Due tomorrow';
  return `Due in ${difference} days`;
}
