import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OSASCRIPT_BIN = "/usr/bin/osascript";
// Calendar.app's AppleScript bridge is slow for date-range queries — same
// class of issue as the already-known ~200s Reminders latency. A generous
// timeout here trades responsiveness for actually completing, rather than
// hard-failing on a query that would have succeeded given more time.
const CALENDAR_TIMEOUT_MS = 120_000;
const CALENDAR_ACCESS_TIMEOUT_MS = 5_000;
const CALENDAR_ACCESS_RETRY_MS = 30_000;
const CALENDAR_MAX_BUFFER = 5 * 1024 * 1024;
const DEFAULT_RANGE_DAYS = 7;

export const LOCAL_CALENDAR_UNSUPPORTED_MESSAGE =
  "Local Apple Calendar reads are only available on macOS.";

export const LOCAL_CALENDAR_ACCESS_MESSAGE =
  "Boop needs macOS Automation permission to read Apple Calendar. When prompted, allow Boop or the terminal app running npm run dev to control Calendar. You can also enable it in System Settings -> Privacy & Security -> Automation. Access is read-only.";

export type LocalCalendarPermission = "granted" | "denied" | "notDetermined";

let cachedCalendarPermission: LocalCalendarPermission = "notDetermined";
let lastCalendarAccessProbeFailedAt = 0;

interface RawEvent {
  id: string;
  calendar: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  status: string | null;
}

export interface LocalEvent {
  id: string;
  calendar: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  status: string | null;
}

export interface LocalCalendarFilters {
  from?: string;
  to?: string;
  calendar?: string;
}

function isMac(): boolean {
  return process.platform === "darwin";
}

function normalizeCalendarError(err: unknown): Error {
  const signal = typeof (err as { signal?: unknown })?.signal === "string"
    ? (err as { signal: string }).signal
    : "";
  const killed = Boolean((err as { killed?: unknown })?.killed);
  const stderr = typeof (err as { stderr?: unknown })?.stderr === "string"
    ? ((err as { stderr: string }).stderr.trim())
    : "";
  const text = stderr || (err instanceof Error ? err.message : String(err));
  if (
    text.includes("Not authorized to send Apple events") ||
    text.includes("not authorized to send Apple events") ||
    text.includes("Application isn") ||
    text.includes("-1743") ||
    text.includes("-1744") ||
    text.includes("User canceled") ||
    text.includes("Operation not permitted")
  ) {
    return new Error(LOCAL_CALENDAR_ACCESS_MESSAGE);
  }
  if (killed || signal === "SIGTERM" || text.includes("timed out") || text.includes("SIGTERM")) {
    return new Error("Apple Calendar was too slow to return data before the read timeout. Try a narrower date range.");
  }
  if (text.includes("syntax error")) {
    return new Error(`Local Apple Calendar read failed: AppleScript syntax error: ${text}`);
  }
  return new Error(`Local Apple Calendar read failed: ${text}`);
}

function isPermissionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(LOCAL_CALENDAR_ACCESS_MESSAGE);
}

async function runCalendarScript<T>(
  script: string,
  env: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!isMac()) throw new Error(LOCAL_CALENDAR_UNSUPPORTED_MESSAGE);
  if (!existsSync(OSASCRIPT_BIN)) {
    throw new Error("osascript is required to read Apple Calendar, but /usr/bin/osascript was not found.");
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      OSASCRIPT_BIN,
      ["-e", script],
      {
        timeout: options.timeoutMs ?? CALENDAR_TIMEOUT_MS,
        maxBuffer: CALENDAR_MAX_BUFFER,
        env: { ...process.env, ...env },
      },
    ));
  } catch (err) {
    throw normalizeCalendarError(err);
  }

  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Apple Calendar returned an empty response.");
  try {
    const parsed = JSON.parse(trimmed) as T;
    cachedCalendarPermission = "granted";
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Apple Calendar returned unreadable data: ${err.message}`);
    }
    throw err;
  }
}

// AppleScript has no clean "parse this ISO string" constructor, and
// `date "..."` parsing is locale-dependent and fragile. Instead, compute how
// many seconds the requested from/to instants are relative to right now in
// Node, then let AppleScript build its own `current date` and offset by that
// — both sides read the same real wall-clock instant on the same machine.
function secondsFromNow(iso: string | undefined, fallbackMs: number): number {
  const ms = iso ? Date.parse(iso) : NaN;
  const targetMs = Number.isFinite(ms) ? ms : Date.now() + fallbackMs;
  return Math.round((targetMs - Date.now()) / 1000);
}

export async function listLocalCalendarEvents(filters: LocalCalendarFilters = {}): Promise<LocalEvent[]> {
  const fromDeltaSeconds = secondsFromNow(filters.from, 0);
  const toDeltaSeconds = secondsFromNow(filters.to, DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await runCalendarScript<RawEvent[]>(LIST_CALENDAR_EVENTS_SCRIPT, {
    BOOP_CALENDAR_FROM_DELTA_SECONDS: String(fromDeltaSeconds),
    BOOP_CALENDAR_TO_DELTA_SECONDS: String(toDeltaSeconds),
    BOOP_CALENDAR_FILTER: filters.calendar?.trim() ?? "",
  });

  return rows.map((row) => ({
    id: row.id,
    calendar: row.calendar,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    location: row.location,
    notes: row.notes,
    status: row.status,
  }));
}

export function getCachedLocalCalendarAccess(): LocalCalendarPermission {
  if (!isMac()) return "denied";
  return cachedCalendarPermission;
}

export async function requestLocalCalendarAccess(): Promise<LocalCalendarPermission> {
  if (!isMac() || !existsSync(OSASCRIPT_BIN)) {
    cachedCalendarPermission = "denied";
    return cachedCalendarPermission;
  }
  if (
    cachedCalendarPermission === "notDetermined" &&
    lastCalendarAccessProbeFailedAt > 0 &&
    Date.now() - lastCalendarAccessProbeFailedAt < CALENDAR_ACCESS_RETRY_MS
  ) {
    return cachedCalendarPermission;
  }
  try {
    await runCalendarScript<{ ok: boolean }>(REQUEST_CALENDAR_ACCESS_SCRIPT, {}, {
      timeoutMs: CALENDAR_ACCESS_TIMEOUT_MS,
    });
    cachedCalendarPermission = "granted";
    lastCalendarAccessProbeFailedAt = 0;
  } catch (err) {
    if (isPermissionError(err)) {
      cachedCalendarPermission = "denied";
      lastCalendarAccessProbeFailedAt = 0;
    } else {
      cachedCalendarPermission = cachedCalendarPermission === "granted" ? "granted" : "notDetermined";
      lastCalendarAccessProbeFailedAt = Date.now();
    }
  }
  return cachedCalendarPermission;
}

const APPLESCRIPT_HELPERS = String.raw`
on replaceText(findText, replaceText, sourceText)
  set AppleScript's text item delimiters to findText
  set textItems to every text item of sourceText
  set AppleScript's text item delimiters to replaceText
  set resultText to textItems as text
  set AppleScript's text item delimiters to ""
  return resultText
end replaceText

on jsonString(sourceValue)
  set sourceText to sourceValue as text
  set sourceText to my replaceText("\\", "\\\\", sourceText)
  set sourceText to my replaceText("\"", "\\\"", sourceText)
  set sourceText to my replaceText(return, "\\n", sourceText)
  set sourceText to my replaceText(linefeed, "\\n", sourceText)
  set sourceText to my replaceText(tab, "\\t", sourceText)
  return "\"" & sourceText & "\""
end jsonString

on jsonNullableString(sourceValue)
  if sourceValue is missing value then return "null"
  if sourceValue is "" then return "null"
  return my jsonString(sourceValue)
end jsonNullableString

on pad2(numberValue)
  set textValue to numberValue as integer as text
  if (count of characters of textValue) is 1 then return "0" & textValue
  return textValue
end pad2

on localIsoDate(dateValue)
  if dateValue is missing value then return ""
  return ((year of dateValue as integer) as text) & "-" & my pad2(month of dateValue as integer) & "-" & my pad2(day of dateValue as integer) & "T" & my pad2(hours of dateValue as integer) & ":" & my pad2(minutes of dateValue as integer) & ":" & my pad2(seconds of dateValue as integer)
end localIsoDate

on jsonNullableDate(dateValue)
  if dateValue is missing value then return "null"
  return my jsonString(my localIsoDate(dateValue))
end jsonNullableDate

on joinJson(jsonItems)
  set AppleScript's text item delimiters to ","
  set resultText to jsonItems as text
  set AppleScript's text item delimiters to ""
  return resultText
end joinJson

`;

const REQUEST_CALENDAR_ACCESS_SCRIPT = String.raw`
tell application "Calendar"
  set appName to name
end tell
return "{\"ok\":true}"
`;

const LIST_CALENDAR_EVENTS_SCRIPT = `${APPLESCRIPT_HELPERS}
set fromDeltaText to system attribute "BOOP_CALENDAR_FROM_DELTA_SECONDS"
set toDeltaText to system attribute "BOOP_CALENDAR_TO_DELTA_SECONDS"
set calendarFilter to system attribute "BOOP_CALENDAR_FILTER"
set fromDate to (current date) + (fromDeltaText as integer)
set toDate to (current date) + (toDeltaText as integer)
set outputRows to {}

tell application "Calendar"
  set sourceCalendars to calendars
  repeat with aCalendar in sourceCalendars
    set calendarName to name of aCalendar as text
    if calendarFilter is "" or calendarName contains calendarFilter then
      set matchingEvents to (every event of aCalendar whose start date is greater than or equal to fromDate and start date is less than or equal to toDate)
      repeat with anEvent in matchingEvents
        set eventProps to properties of anEvent
        set isAllDay to allday event of eventProps
        set alldayJson to "false"
        if isAllDay then set alldayJson to "true"
        set eventStatus to "none"
        try
          set eventStatus to (status of eventProps) as text
        end try
        set rowJson to "{" & ¬
          "\\"id\\":" & my jsonString(uid of eventProps) & "," & ¬
          "\\"calendar\\":" & my jsonString(calendarName) & "," & ¬
          "\\"title\\":" & my jsonString(summary of eventProps) & "," & ¬
          "\\"startsAt\\":" & my jsonNullableDate(start date of eventProps) & "," & ¬
          "\\"endsAt\\":" & my jsonNullableDate(end date of eventProps) & "," & ¬
          "\\"allDay\\":" & alldayJson & "," & ¬
          "\\"location\\":" & my jsonNullableString(location of eventProps) & "," & ¬
          "\\"notes\\":" & my jsonNullableString(description of eventProps) & "," & ¬
          "\\"status\\":" & my jsonNullableString(eventStatus) & ¬
          "}"
        set end of outputRows to rowJson
      end repeat
    end if
  end repeat
end tell

return "[" & my joinJson(outputRows) & "]"
`;
