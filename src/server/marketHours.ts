/**
 * Shared spot-FX market clock.
 *
 * The weekly close/open are interpreted in America/New_York so the rule follows
 * US daylight-saving changes without relying on the server's local timezone.
 * Session buckets are exclusive reporting buckets in New York local time.
 */
export const FOREX_MARKET_TIME_ZONE = 'America/New_York';

type NewYorkParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: FOREX_MARKET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function newYorkParts(value: string | Date | number): NewYorkParts | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekday = WEEKDAY_INDEX[get('weekday')];
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if ([weekday, year, month, day, hour, minute].some(value => !Number.isFinite(value))) return null;
  return { year, month, day, weekday, hour, minute };
}

/** New York's UTC offset in minutes at this instant (e.g. -300 in EST). */
function newYorkUtcOffsetMinutes(value: string | Date | number): number {
  const date = new Date(value);
  const parts = newYorkParts(date);
  if (!parts) throw new Error('Invalid timestamp supplied to the forex market clock.');
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const instantMinute = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((localAsUtc - instantMinute) / 60_000);
}

/** Convert an unambiguous New York wall-clock time to UTC. Used for Friday 17:00. */
function newYorkWallClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const represented = newYorkParts(guess);
    if (!represented) throw new Error('Could not resolve New York market boundary.');
    const representedAsUtc = Date.UTC(
      represented.year, represented.month - 1, represented.day,
      represented.hour, represented.minute
    );
    const correction = targetAsUtc - representedAsUtc;
    guess += correction;
    if (Math.abs(correction) < 1_000) break;
  }
  return guess;
}

/**
 * Spot FX is closed from Friday 17:00 New York time until Sunday 17:00
 * New York time. No server timezone or fixed UTC offset is assumed.
 */
export function isForexMarketOpenAt(value: string | Date | number = Date.now()): boolean {
  const parts = newYorkParts(value);
  if (!parts) return false;
  const minuteOfDay = parts.hour * 60 + parts.minute;
  if (parts.weekday === 6) return false; // Saturday
  if (parts.weekday === 0) return minuteOfDay >= 17 * 60; // Sunday after 17:00
  if (parts.weekday === 5) return minuteOfDay < 17 * 60; // Friday before 17:00
  return true; // Monday–Thursday
}

export function getForexMarketState(value: string | Date | number = Date.now()): {
  isOpen: boolean;
  status: 'OPEN' | 'WEEKEND_CLOSED' | 'INVALID_TIME';
  message: string;
} {
  const parts = newYorkParts(value);
  if (!parts) {
    return { isOpen: false, status: 'INVALID_TIME', message: 'Market clock unavailable: invalid timestamp.' };
  }
  if (isForexMarketOpenAt(value)) {
    return { isOpen: true, status: 'OPEN', message: 'Spot FX market open.' };
  }
  if (parts.weekday === 5 || parts.weekday === 6) {
    return {
      isOpen: false,
      status: 'WEEKEND_CLOSED',
      message: 'Weekend closure: spot FX reopens Sunday at 5:00 PM New York time.',
    };
  }
  return {
    isOpen: false,
    status: 'WEEKEND_CLOSED',
    message: 'Weekend closure: spot FX opens today at 5:00 PM New York time.',
  };
}

/** Find the next Friday 17:00 New York close after the supplied timestamp. */
function nextWeeklyCloseMs(value: string | Date | number): number {
  const parts = newYorkParts(value);
  if (!parts) throw new Error('Invalid timestamp supplied to the forex market clock.');
  const minuteOfDay = parts.hour * 60 + parts.minute;
  let daysUntilFriday = (5 - parts.weekday + 7) % 7;
  if (parts.weekday === 5 && minuteOfDay >= 17 * 60) daysUntilFriday = 7;
  const targetDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysUntilFriday));
  return newYorkWallClockToUtcMs(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth() + 1,
    targetDate.getUTCDate(),
    17,
    0
  );
}

/**
 * Validates all three timestamps for a causal paper signal. The decision and
 * its complete entry-to-expiry interval must fall inside the open FX week.
 */
export function isForexSignalScheduleValid(
  predictionTimeMs: number,
  entryTimeMs: number,
  expiryTimeMs: number
): boolean {
  if (!Number.isFinite(predictionTimeMs) || !Number.isFinite(entryTimeMs) ||
      !Number.isFinite(expiryTimeMs) || predictionTimeMs > entryTimeMs ||
      !isForexMarketOpenAt(predictionTimeMs)) return false;
  return isForexMarketIntervalOpen(entryTimeMs, expiryTimeMs);
}

/** True only when the whole [entry, expiry) interval occurs before the weekly close. */
export function isForexMarketIntervalOpen(
  entryTimeMs: number,
  expiryTimeMs: number
): boolean {
  if (!Number.isFinite(entryTimeMs) || !Number.isFinite(expiryTimeMs) ||
      expiryTimeMs <= entryTimeMs || !isForexMarketOpenAt(entryTimeMs)) return false;
  return expiryTimeMs < nextWeeklyCloseMs(entryTimeMs);
}

interface SessionDefinition {
  id: 'ASIA' | 'LONDON' | 'OVERLAP' | 'NEW_YORK' | 'LATE_NEW_YORK';
  name: string;
  shortName: string;
  startMinute: number;
  endMinute: number;
  hoursLabel: string;
}

const SESSION_DEFINITIONS: SessionDefinition[] = [
  { id: 'ASIA', name: 'Asian Session', shortName: 'Asia', startMinute: 17 * 60, endMinute: 3 * 60, hoursLabel: '5:00 PM–3:00 AM ET' },
  { id: 'LONDON', name: 'London Session', shortName: 'London', startMinute: 3 * 60, endMinute: 8 * 60, hoursLabel: '3:00 AM–8:00 AM ET' },
  { id: 'OVERLAP', name: 'London / New York Overlap', shortName: 'Overlap', startMinute: 8 * 60, endMinute: 12 * 60, hoursLabel: '8:00 AM–12:00 PM ET' },
  { id: 'NEW_YORK', name: 'New York Session', shortName: 'New York', startMinute: 12 * 60, endMinute: 14 * 60, hoursLabel: '12:00 PM–2:00 PM ET' },
  { id: 'LATE_NEW_YORK', name: 'Late New York (US Late Session)', shortName: 'Late NY', startMinute: 14 * 60, endMinute: 17 * 60, hoursLabel: '2:00 PM–5:00 PM ET' },
];

function formatClock(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function describeSession(definition: SessionDefinition, value: string | Date | number) {
  const offset = newYorkUtcOffsetMinutes(value);
  const istDelta = 330 - offset; // IST is UTC+05:30; New York offset is DST-aware.
  return {
    id: definition.id,
    name: definition.name,
    shortName: definition.shortName,
    hoursLabel: `${definition.hoursLabel} (DST-aware)`,
    utcRange: `${formatClock(definition.startMinute - offset)}–${formatClock(definition.endMinute - offset)} UTC`,
    istRange: `${formatClock(definition.startMinute + istDelta)}–${formatClock(definition.endMinute + istDelta)} IST`,
  };
}

export function getMarketSessionDefinitions(value: string | Date | number = Date.now()) {
  return SESSION_DEFINITIONS.map(definition => describeSession(definition, value));
}

/**
 * Exclusive performance buckets, anchored to New York local time:
 * Asia 17:00–03:00; London 03:00–08:00; overlap 08:00–12:00;
 * New York 12:00–14:00; late New York 14:00–17:00.
 * The corresponding UTC/IST labels adjust automatically for US daylight saving.
 */
export function getSessionFromTimestamp(timestampUtc: string | Date | number): {
  id: SessionDefinition['id'];
  name: string;
  shortName: string;
  hoursLabel: string;
  utcRange: string;
  istRange: string;
} {
  const parts = newYorkParts(timestampUtc);
  if (!parts) throw new Error('Invalid timestamp supplied for session classification.');
  const minute = parts.hour * 60 + parts.minute;
  let definition: SessionDefinition;
  if (minute >= 17 * 60 || minute < 3 * 60) definition = SESSION_DEFINITIONS[0];
  else if (minute < 8 * 60) definition = SESSION_DEFINITIONS[1];
  else if (minute < 12 * 60) definition = SESSION_DEFINITIONS[2];
  else if (minute < 14 * 60) definition = SESSION_DEFINITIONS[3];
  else definition = SESSION_DEFINITIONS[4];
  return describeSession(definition, timestampUtc);
}
