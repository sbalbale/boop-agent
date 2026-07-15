---
name: self-learning
description: When and how to use write_skill to turn something you just learned into a reusable skill, instead of re-learning it every future turn.
---

# Self-learning: writing good skills

You can call `write_skill(name, description, body)` to save a new skill, or
overwrite an existing one. This is how you improve over time instead of
repeating the same mistakes — but a bad or careless skill is actively worse
than no skill, since future turns will trust and follow it. Be deliberate.

## When to write one

Write a skill when you hit a REAL, DURABLE problem and worked out a fix that
will generalize — not for a one-off task result. Good signals:
- A tool's defaults or behavior silently produced a wrong/incomplete result
  (missed data, blew the context window, misattributed something) and you
  figured out the specific parameter or sequence that fixes it.
- You'd genuinely want your own future self (or a sub-agent) to know this
  before attempting a similar task again.
- **The user corrected you, or asked a follow-up adding requirements you
  should have included the first time, more than once in the same
  conversation about the same kind of request.** This is the clearest signal
  of all and the easiest to miss: if someone has to ask "what about X?" or
  "you forgot Y" twice for the same type of task, write the skill yourself,
  immediately, as soon as you notice the pattern — do NOT wait for them to
  explicitly say "make this a skill." Being asked to save a skill after
  already being corrected twice means you should have caught it on your own.

Bad reasons to write one:
- "I finished this task" — that's just doing the task, not a lesson.
- A one-time fact about the user (that's memory, via write_memory, not a
  skill — skills are about HOW to use tools, not WHAT is true about the user).
- You're not actually sure the fix is correct or durable. An untested theory
  written as confident guidance will mislead whoever reads it next.

## How to write a good one

- `name`: lowercase-kebab-case, specific enough to be found again (e.g.
  `slack-thread-search`, not `slack-tips`).
- `description`: one sentence, written so it's obvious from the always-visible
  skills index whether this skill applies to the task at hand. This is the
  ONLY part of the skill seen before deciding to load it — vague descriptions
  mean a relevant skill never gets used.
- `body`: name the actual tool(s) and parameter(s) involved, state the wrong
  behavior you saw, and state the fix directly and concretely. A concrete
  example (even a placeholder one, never real user data) helps future-you
  recognize the same situation faster than an abstract rule would.

## Updating vs. creating

If a skill already exists for the same tool/situation and you learned
something that refines or corrects it, update that skill (same name) rather
than creating a near-duplicate with a slightly different name — a growing
pile of overlapping skills is harder to search than one skill kept current.
Check the skills index for anything already close to what you're about to
write before creating a new one.
