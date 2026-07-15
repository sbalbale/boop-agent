---
name: imessage-search
description: How to search iMessage/SMS threads so replies phrased differently than the search keyword aren't missed, and how to read the results correctly once you have them.
---

# iMessage search

Find the THREAD first, then read it — don't keyword-search across everyone's
messages.

1. Call `apple_list_chats` (or use `participant` directly if you already know
   it) to find the right `chat_id`/`participant` for the person named.
2. Call `apple_read_messages` with that `chat_id` or `participant`.

A reply like "I have a dinner but Jordan should be back" will not itself
contain a keyword like "pickup" — but `apple_read_messages` automatically
includes a few messages before/after each `query` match in the same thread
(the `context` parameter, default 3), specifically so replies phrased
differently are still visible. The match itself is also whitespace-insensitive
("pick up" and "pickup" both match either spelling), so don't worry about
getting the exact spacing right.

So it's fine, and usually better, to pass `query` set to the topic keyword
alongside `chat_id`/`participant` rather than omitting it — you don't need to
read the entire thread unfiltered. Only raise `context` (or drop `query`
entirely) if the default window doesn't reach far enough to show the reply
you need.

## Reading the results correctly

The reply you're looking for usually will NOT repeat the search keyword — do
not require it to. Treat ANY message from the other person that comes
chronologically shortly after the message you were originally looking for as
their reply/response to it, and report it as such, even if it doesn't mention
the original topic word at all. A one-line reply like "kk", "yeah works", or
"I have a dinner but X should be back" sent a minute after your question about
a pickup IS the answer to that question — don't conclude "no reply" or
"nothing about a pickup" just because that specific message lacks the word
"pickup".
