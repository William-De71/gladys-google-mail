// -----------------------------------------------------------------------------
// The Gmail vacation responder (users.settings.getVacation / updateVacation).
//
// VacationSettings: enableAutoReply, responseSubject, responseBodyPlainText,
// responseBodyHtml, restrictToContacts, restrictToDomain, startTime and
// endTime (epoch ms, as strings). Dates typed by users are read in the time
// zone of Gladys (TZ): "2026-12-24", "2026-12-24 18:00", "24/12/2026",
// "24/12/2026 18:00" or "+3" (in 3 days, same time).
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 10000;

/** An invalid vacation input. */
class VacationInputError extends Error {
  /**
   * @param {string} message - The message.
   * @param {string} code - `invalid_date`, `end_before_start`, `empty`.
   */
  constructor(message, code) {
    super(message);
    this.name = 'VacationInputError';
    this.code = code;
  }
}

/**
 * @description A time zone Intl accepts, or undefined (the system one).
 * @param {string} [zone] - The IANA name.
 * @returns {string|undefined} The zone.
 */
function safeTimeZone(zone) {
  if (!zone) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/**
 * @description The wall clock of an instant in a zone.
 * @param {number} instant - Epoch ms.
 * @param {string} [zone] - The zone.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number }} The parts.
 */
function wallClock(instant, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/**
 * @description The instant of a wall clock time in a zone (DST aware).
 * @param {object} wall - `{ year, month, day, hour, minute }`.
 * @param {string} [zone] - The zone.
 * @returns {number} Epoch ms.
 */
function instantOf({ year, month, day, hour, minute }, zone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  // Two passes converge for every real zone (the offset of the guess, then
  // the offset of the corrected guess).
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(guess, zone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += target - seenUtc;
  }
  return guess;
}

/**
 * @description Read a date typed by a user.
 * @param {unknown} raw - The text.
 * @param {object} context - `{ now, zone, endOfDay }`: a date without a time
 *   is 00:00, or 23:59 with `endOfDay`.
 * @returns {number|null} Epoch ms, null when empty.
 * @throws {VacationInputError} When the text is not a date.
 * @example
 * parseUserDate('2026-12-24', { now, zone: 'Europe/Paris' });
 */
function parseUserDate(raw, { now, zone, endOfDay = false }) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  const relative = /^\+\s*(\d{1,3})$/.exec(text);
  if (relative) {
    return now + Number(relative[1]) * DAY_MS;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text);
  const european = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?$/.exec(text);
  let wall;
  if (iso) {
    wall = { year: +iso[1], month: +iso[2], day: +iso[3], hour: iso[4], minute: iso[5] };
  } else if (european) {
    wall = {
      year: +european[3],
      month: +european[2],
      day: +european[1],
      hour: european[4],
      minute: european[5],
    };
  } else {
    throw new VacationInputError(`Not a date: ${text.slice(0, 40)}`, 'invalid_date');
  }
  const withTime = wall.hour !== undefined;
  const full = {
    ...wall,
    hour: withTime ? Number(wall.hour) : endOfDay ? 23 : 0,
    minute: withTime ? Number(wall.minute) : endOfDay ? 59 : 0,
  };
  const check = new Date(Date.UTC(full.year, full.month - 1, full.day));
  if (
    check.getUTCMonth() !== full.month - 1 ||
    check.getUTCDate() !== full.day ||
    full.hour > 23 ||
    full.minute > 59
  ) {
    throw new VacationInputError(`Not a date: ${text.slice(0, 40)}`, 'invalid_date');
  }
  return instantOf(full, zone);
}

/**
 * @description The VacationSettings to turn the responder on.
 * @param {object} input - `{ subject, message, start, end, contactsOnly }`
 *   (start/end epoch ms or null).
 * @returns {object} The settings.
 * @throws {VacationInputError} Without a subject nor a message, or with an end before the start.
 */
function enableSettings({ subject, message, start = null, end = null, contactsOnly = false }) {
  const cleanSubject = String(subject ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT);
  const cleanMessage = String(message ?? '')
    .trim()
    .slice(0, MAX_MESSAGE);
  if (!cleanSubject && !cleanMessage) {
    // Gmail needs one of them to enable auto-replies.
    throw new VacationInputError('A subject or a message is needed', 'empty');
  }
  if (start !== null && end !== null && end <= start) {
    throw new VacationInputError('The end is before the start', 'end_before_start');
  }
  return {
    enableAutoReply: true,
    responseSubject: cleanSubject,
    responseBodyPlainText: cleanMessage,
    restrictToContacts: Boolean(contactsOnly),
    ...(start !== null ? { startTime: String(start) } : {}),
    ...(end !== null ? { endTime: String(end) } : {}),
  };
}

/**
 * @description The VacationSettings to turn the responder off (the texts are kept).
 * @param {object} current - The current settings.
 * @returns {object} The settings.
 */
function disableSettings(current = {}) {
  return { ...current, enableAutoReply: false };
}

/**
 * @description A readable view of the settings.
 * @param {object} settings - VacationSettings.
 * @param {number} now - Now, epoch ms.
 * @returns {object} `{ enabled, active, subject, message, start, end, contactsOnly }`:
 *   `active` = enabled and inside its dates.
 */
function describeVacation(settings = {}, now) {
  const start = Number(settings.startTime) || null;
  const end = Number(settings.endTime) || null;
  const enabled = Boolean(settings.enableAutoReply);
  return {
    enabled,
    active: enabled && (start === null || start <= now) && (end === null || now < end),
    expired: enabled && end !== null && now >= end,
    subject: String(settings.responseSubject ?? ''),
    message: String(settings.responseBodyPlainText ?? ''),
    start,
    end,
    contactsOnly: Boolean(settings.restrictToContacts),
  };
}

export {
  DAY_MS,
  VacationInputError,
  safeTimeZone,
  wallClock,
  instantOf,
  parseUserDate,
  enableSettings,
  disableSettings,
  describeVacation,
};
