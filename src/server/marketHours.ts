import type { MarketSessionId, MarketSessionInfo } from '../types/index.ts';

/**
 * Institutional Spot FX market hours helper.
 * Standard FX week: Sunday 17:00 New York to Friday 17:00 New York.
 * Handles US Daylight Saving Time (EDT vs EST) dynamically.
 */

interface NewYorkDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  isDst: boolean;
}

export function getNewYorkParts(dateInput: Date | string | number): NewYorkDateParts {
  const date = new Date(dateInput);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid timestamp supplied for market hours evaluation.');
  }

  // Format using America/New_York
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    timeZoneName: 'short',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const findVal = (type: string) => parts.find(p => p.type === type)?.value || '';

  const weekdayStr = findVal('weekday');
  const dayOfWeekMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const tzName = findVal('timeZoneName');
  const isDst = tzName === 'EDT' || tzName === 'GMT-4';

  return {
    year: parseInt(findVal('year'), 10),
    month: parseInt(findVal('month'), 10),
    day: parseInt(findVal('day'), 10),
    hour: parseInt(findVal('hour'), 10) % 24,
    minute: parseInt(findVal('minute'), 10),
    second: parseInt(findVal('second'), 10),
    dayOfWeek: dayOfWeekMap[weekdayStr] ?? date.getUTCDay(),
    isDst,
  };
}

export function isForexMarketOpenAt(timestamp: Date | string | number): boolean {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return false;
  const ny = getNewYorkParts(d);

  // Market closes Friday at 17:00 NY
  if (ny.dayOfWeek === 5) {
    if (ny.hour >= 17) {
      return false;
    }
    return true;
  }

  // Saturday: all day closed
  if (ny.dayOfWeek === 6) {
    return false;
  }

  // Sunday: opens at 17:00 NY
  if (ny.dayOfWeek === 0) {
    if (ny.hour < 17) {
      return false;
    }
    return true;
  }

  // Mon-Thu: open 24 hours
  return true;
}

export interface ForexMarketState {
  isOpen: boolean;
  status: 'OPEN' | 'WEEKEND_CLOSED';
  message: string;
}

export function getForexMarketState(dateInput: Date | string | number): ForexMarketState {
  const d = new Date(dateInput);
  const isOpen = isForexMarketOpenAt(d);
  if (isOpen) {
    return {
      isOpen: true,
      status: 'OPEN',
      message: 'Spot FX market is open.',
    };
  }

  const ny = getNewYorkParts(d);
  const reopenIst = ny.isDst ? 'Monday 2:30 AM IST' : 'Monday 3:30 AM IST';
  return {
    isOpen: false,
    status: 'WEEKEND_CLOSED',
    message: `Forex market is closed for the weekend. Trading resumes at ${reopenIst}.`,
  };
}

export function isForexMarketIntervalOpen(startMs: number, endMs: number): boolean {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }
  // Check start and end
  if (!isForexMarketOpenAt(startMs) || !isForexMarketOpenAt(endMs)) {
    return false;
  }

  // Check if interval spans across weekend closure
  const startNy = getNewYorkParts(startMs);
  const endNy = getNewYorkParts(endMs);

  // If start is Friday and end is on weekend or next week
  if (startNy.dayOfWeek === 5 && (endNy.dayOfWeek === 6 || endNy.dayOfWeek === 0 || endNy.dayOfWeek === 1)) {
    return false;
  }

  // If interval is longer than 5 days, it must cross a weekend
  if (endMs - startMs > 5 * 24 * 60 * 60 * 1000) return false;

  // Step check in 1-hour increments or boundary
  let cursor = startMs;
  while (cursor < endMs) {
    if (!isForexMarketOpenAt(cursor)) return false;
    cursor += 30 * 60 * 1000;
  }

  return true;
}

export function isForexSignalScheduleValid(
  decisionMs: number,
  entryMs: number,
  expiryMs: number
): boolean {
  if (!Number.isFinite(decisionMs) || !Number.isFinite(entryMs) || !Number.isFinite(expiryMs)) {
    return false;
  }
  if (decisionMs > entryMs || entryMs >= expiryMs) return false;

  // Decision must be made when market is open
  if (!isForexMarketOpenAt(decisionMs)) return false;

  // Complete interval from entry to expiry must be open
  if (!isForexMarketIntervalOpen(entryMs, expiryMs)) return false;

  // Ensure decision and entry are in the same trading week
  const decisionNy = getNewYorkParts(decisionMs);
  const entryNy = getNewYorkParts(entryMs);
  if (decisionNy.dayOfWeek === 5 && entryNy.dayOfWeek === 0) return false; // Friday decision into Sunday entry

  return true;
}

export interface ReportingSession {
  id: MarketSessionId;
  name: string;
  shortName: string;
  hoursLabel: string;
  utcRange: string;
  istRange: string;
}

export function getReportingSessionFromTimestamp(timestampUtc: string | Date | number): ReportingSession {
  const d = new Date(timestampUtc);
  const ny = getNewYorkParts(d);
  const hour = ny.hour;

  // Institutional NY hour divisions:
  // ASIA: 17:00 to 03:00 NY
  // LONDON: 03:00 to 08:00 NY
  // OVERLAP: 08:00 to 12:00 NY
  // NEW_YORK: 12:00 to 14:00 NY
  // LATE_NEW_YORK: 14:00 to 17:00 NY
  const isSummer = ny.isDst; // EDT vs EST

  if (hour >= 8 && hour < 12) {
    return {
      id: 'OVERLAP',
      name: 'London / New York Overlap',
      shortName: 'Overlap',
      hoursLabel: isSummer ? '05:30 PM - 09:30 PM IST' : '06:30 PM - 10:30 PM IST',
      utcRange: isSummer ? '12:00–16:00 UTC' : '13:00–17:00 UTC',
      istRange: isSummer ? '05:30 PM - 09:30 PM IST' : '06:30 PM - 10:30 PM IST',
    };
  }

  if (hour >= 3 && hour < 8) {
    return {
      id: 'LONDON',
      name: 'London Session',
      shortName: 'London',
      hoursLabel: isSummer ? '12:30 PM - 05:30 PM IST' : '01:30 PM - 06:30 PM IST',
      utcRange: isSummer ? '07:00–12:00 UTC' : '08:00–13:00 UTC',
      istRange: isSummer ? '12:30 PM - 05:30 PM IST' : '01:30 PM - 06:30 PM IST',
    };
  }

  if (hour >= 12 && hour < 14) {
    return {
      id: 'NEW_YORK',
      name: 'New York Session',
      shortName: 'New York',
      hoursLabel: isSummer ? '09:30 PM - 11:30 PM IST' : '10:30 PM - 12:30 AM IST',
      utcRange: isSummer ? '16:00–18:00 UTC' : '17:00–19:00 UTC',
      istRange: isSummer ? '09:30 PM - 11:30 PM IST' : '10:30 PM - 12:30 AM IST',
    };
  }

  if (hour >= 14 && hour < 17) {
    return {
      id: 'LATE_NEW_YORK',
      name: 'Late New York Session',
      shortName: 'Late NY',
      hoursLabel: isSummer ? '11:30 PM - 02:30 AM IST' : '12:30 AM - 03:30 AM IST',
      utcRange: isSummer ? '18:00–21:00 UTC' : '19:00–22:00 UTC',
      istRange: isSummer ? '11:30 PM - 02:30 AM IST' : '12:30 AM - 03:30 AM IST',
    };
  }

  // Otherwise ASIA (17:00 to 03:00 NY)
  return {
    id: 'ASIA',
    name: 'Asian Session',
    shortName: 'Asia',
    hoursLabel: isSummer ? '02:30 AM - 12:30 PM IST' : '03:30 AM - 01:30 PM IST',
    utcRange: isSummer ? '21:00–07:00 UTC' : '22:00–08:00 UTC',
    istRange: isSummer ? '02:30 AM - 12:30 PM IST' : '03:30 AM - 01:30 PM IST',
  };
}

export function getMarketSessionDefinitions(now: Date = new Date()): ReportingSession[] {
  const ny = getNewYorkParts(now);
  const isSummer = ny.isDst;
  return [
    {
      id: 'ASIA',
      name: 'Asian Session (Tokyo/Sydney)',
      shortName: 'Asia',
      hoursLabel: isSummer ? '02:30 AM - 12:30 PM IST' : '03:30 AM - 01:30 PM IST',
      utcRange: isSummer ? '21:00–07:00 UTC' : '22:00–08:00 UTC',
      istRange: isSummer ? '02:30 AM - 12:30 PM IST' : '03:30 AM - 01:30 PM IST',
    },
    {
      id: 'LONDON',
      name: 'London Session (European Open)',
      shortName: 'London',
      hoursLabel: isSummer ? '12:30 PM - 05:30 PM IST' : '01:30 PM - 06:30 PM IST',
      utcRange: isSummer ? '07:00–12:00 UTC' : '08:00–13:00 UTC',
      istRange: isSummer ? '12:30 PM - 05:30 PM IST' : '01:30 PM - 06:30 PM IST',
    },
    {
      id: 'OVERLAP',
      name: 'London / New York Overlap (Peak Volatility)',
      shortName: 'Overlap',
      hoursLabel: isSummer ? '05:30 PM - 09:30 PM IST' : '06:30 PM - 10:30 PM IST',
      utcRange: isSummer ? '12:00–16:00 UTC' : '13:00–17:00 UTC',
      istRange: isSummer ? '05:30 PM - 09:30 PM IST' : '06:30 PM - 10:30 PM IST',
    },
    {
      id: 'NEW_YORK',
      name: 'New York Session (US Morning/Midday)',
      shortName: 'New York',
      hoursLabel: isSummer ? '09:30 PM - 11:30 PM IST' : '10:30 PM - 12:30 AM IST',
      utcRange: isSummer ? '16:00–18:00 UTC' : '17:00–19:00 UTC',
      istRange: isSummer ? '09:30 PM - 11:30 PM IST' : '10:30 PM - 12:30 AM IST',
    },
    {
      id: 'LATE_NEW_YORK',
      name: 'Late New York Session (US Afternoon/Close)',
      shortName: 'Late NY',
      hoursLabel: isSummer ? '11:30 PM - 02:30 AM IST' : '12:30 AM - 03:30 AM IST',
      utcRange: isSummer ? '18:00–21:00 UTC' : '19:00–22:00 UTC',
      istRange: isSummer ? '11:30 PM - 02:30 AM IST' : '12:30 AM - 03:30 AM IST',
    },
  ];
}
