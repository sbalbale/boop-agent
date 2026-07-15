---
name: google-calendar-search
description: How to check a user's Google Calendar across ALL of their calendars, not just the primary one, when checking availability or looking for conflicts.
---

# Google Calendar — checking across all calendars

Google accounts commonly have more than one calendar (primary, shared,
subscribed, work, etc.). The single-calendar tools —
`GOOGLECALENDAR_FIND_EVENT` and `GOOGLECALENDAR_EVENTS_LIST` — only look at
one calendar at a time and default to the user's primary calendar if you
don't pass a `calendar_id`. Using only these will silently miss anything on
a secondary or shared calendar, which looks like "no conflicts" when there
actually are some.

For any task that's checking availability broadly ("do I have anything
today", "any conflicts with X", "am I free Thursday") — not looking for one
specific known event — use `GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS`
instead. It takes `time_min`/`time_max` (RFC3339 with a timezone offset, no
`calendar_id` needed) and returns a unified event list across every calendar
in the user's calendar list automatically.

If you specifically need to know what calendars exist (their ids/names,
e.g. to report on or filter to just one named calendar), call
`GOOGLECALENDAR_LIST_CALENDARS` first.

Only fall back to the single-calendar tools when the user has explicitly
named one specific calendar to check, or when you already have one specific
event's `calendar_id` from a prior lookup (e.g. to update/delete it).
