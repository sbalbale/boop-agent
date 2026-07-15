---
name: gmail-search
description: How to size, filter, and sequence tool calls against Gmail/Calendar-style integrations without blowing the execution agent's context window.
---

# Gmail / Calendar tool call sizing

Applies to Gmail, Calendar, and similar data-fetching tools.

- ALWAYS pass the smallest reasonable `limit`/`max_results`/`count` parameter
  the tool accepts — never call a fetch/search/list tool with no limit at
  all. Default to something like 5-10 results unless the task clearly needs
  more.
- ALWAYS use the tool's own query/filter parameters (sender, subject, date
  range, label, keywords) to narrow results server-side, instead of fetching
  broadly and filtering yourself afterward.
- If a task requires more than one page of results, fetch one page, check
  whether it already answers the task, and only fetch more if genuinely
  necessary — don't pre-emptively pull everything.
- These tools can return large raw payloads (full email/message bodies) that
  blow past your own context window if fetched unbounded — a request that's
  too large will fail outright rather than degrade gracefully, so err on the
  side of fetching less.

## Gmail specifically — search in two passes, cheap then expensive

1. First call `GMAIL_FETCH_EMAILS` with `verbose:false` and
   `include_payload:false` (both default to `true`, which pulls full
   bodies/attachments and is what blows the context — you must explicitly
   set them false). This returns only subject/sender/recipient/time/labels
   per message, at a fraction of the cost. Use the `query` parameter (Gmail
   search syntax: `from:`, `subject:`, `after:YYYY/MM/DD`, `is:unread`, etc.)
   to narrow before fetching, not after.
2. Look at the subjects/senders/dates from that lightweight pass and identify
   which specific messages actually look relevant to the task.
3. Only for those specific candidates, call
   `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` (using the message id from step 1) to
   get the full body/details you actually need to answer the question.

Do not call `GMAIL_FETCH_EMAILS` with `verbose`/`include_payload` left at
their defaults (`true`) for anything more than 1 message — that combination
is what has caused real failures here.
