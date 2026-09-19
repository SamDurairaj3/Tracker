import {
  addLocalDays,
  calendarDayDifference,
  formatDateRange,
  localDateKey,
  parseLocalDate,
} from './local-time';
import type { WorkItem } from './work-items';

export type Timeline = {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  days: number;
  todayIndex: number;
  rangeLabel: string;
  weeks: Array<{
    key: string;
    label: string;
    sublabel: string;
    startIndex: number;
    span: number;
  }>;
};

function startOfWeek(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7;
  return addLocalDays(date, -mondayOffset);
}

function endOfWeek(date: Date) {
  return addLocalDays(startOfWeek(date), 6);
}

function isoWeek(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function minDate(values: Date[]) {
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function maxDate(values: Date[]) {
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

export function buildTimeline(items: WorkItem[], now: Date): Timeline {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDates = items.flatMap((item) => [parseLocalDate(item.start), parseLocalDate(item.due)])
    .filter((value): value is Date => value !== null);
  const start = startOfWeek(minDate([today, ...itemDates]));
  const latest = maxDate([today, ...itemDates]);
  const minimumEnd = addLocalDays(start, 27);
  const end = endOfWeek(latest.getTime() > minimumEnd.getTime() ? latest : minimumEnd);
  const startKey = localDateKey(start);
  const endKey = localDateKey(end);
  const days = (calendarDayDifference(startKey, endKey) ?? 27) + 1;
  const weeks = [];

  for (let index = 0; index < days; index += 7) {
    const weekStart = addLocalDays(start, index);
    const weekEnd = addLocalDays(weekStart, Math.min(6, days - index - 1));
    weeks.push({
      key: localDateKey(weekStart),
      label: new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' }).formatRange(weekStart, weekEnd),
      sublabel: `Week ${isoWeek(weekStart)}`,
      startIndex: index,
      span: Math.min(7, days - index),
    });
  }

  return {
    start,
    end,
    startKey,
    endKey,
    days,
    todayIndex: calendarDayDifference(startKey, localDateKey(today)) ?? 0,
    rangeLabel: formatDateRange(start, end),
    weeks,
  };
}

export function timelinePosition(item: WorkItem, timeline: Timeline) {
  const rawStart = calendarDayDifference(timeline.startKey, item.start);
  const rawEnd = calendarDayDifference(timeline.startKey, item.due);
  if (rawStart === null || rawEnd === null || rawEnd < 0 || rawStart >= timeline.days) {
    return null;
  }
  const start = Math.max(0, rawStart);
  const end = Math.min(timeline.days - 1, Math.max(rawStart, rawEnd));
  return {
    gridColumn: `${start + 1} / span ${end - start + 1}`,
    clippedStart: rawStart < 0,
    clippedEnd: rawEnd >= timeline.days,
  };
}
