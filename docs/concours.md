# The contest, what we know as of August 28, 2026

Research carried out by three agents in parallel on the primary sources: the
Devpost page and its tabs, OpenAI's FAQ, the Chrome documentation, the
specification repository, and the GitHub repositories created during the
contest window.

This document keeps only what is sourced. What could not be established is
listed at the end, and that section is not short.

---

## The calendar, and a freeze that has to be taken seriously

| Deadline                    | Date                            |
| --------------------------- | ------------------------------- |
| Submissions close           | **September 3, 2026, 13:00 PT** |
| Netlify credits form        | September 1, 12:00 PT           |
| OpenAI Discord office hours | August 31, 11:00 PT             |
| Judging                     | September 4 → 21                |
| Announcement                | ~September 23 (may slip)        |

The freeze is the most binding point, and it is not on the rules page. The
single update published by the organizers states that the description, the
video, the repository and the live site are frozen at the close, and that “any
edit, no matter how minor, risks your eligibility for prizes”.

Practical consequence: no commit on the submitted repository and no
redeployment after September 3, 13:00 PT, and the freeze probably has to hold
until the announcement. The last commit must be laid down several hours before,
not in the last minute.

## The video is more demanding than the rules page suggests

- Under three minutes, on YouTube, set to Public: the wording is “publicly
  visible”, and nothing says that “unlisted” is enough.
- **Audio narration is mandatory.** A screen capture with music is explicitly
  declared non-compliant.
- AI text-to-speech is explicitly allowed.
- Show the project working in the first ten to fifteen seconds.

## A contradiction we have to carry

The rules say: “Judges are not required to test the Project and may choose to
judge based solely on the text description, images, and video.” OpenAI's FAQ
says: “Judges will also visit your live URL directly.”

The rules are declared to prevail. The FAQ also contains a copy-paste artifact
(“Since there's no video”) that contradicts the mandatory video: it is not
reliable.

So both have to be assumed: the writing and the video must stand on their own,
_and_ the URL must work cold.

## The demonstration environment can produce an empty demo

OpenAI's documentation states that site tools require GPT-5.6 Sol or Terra;
Luna has WebMCP disabled. ChatGPT's built-in browser also discovers no tool
registered inside an iframe, even same-origin, and does not support the
declarative API.

Filming against Luna would amount to filming a page with no tools.

---

## The landscape: “the agent proposes, the human disposes” is not a differentiator

This is the most useful conclusion of this research, and it is unpleasant.

Of 397 described repositories created during the contest window, 65 (~16%)
foreground human approval, proposal gating or consent, more than commerce (27),
forms (30) or games (21). Two projects implement a blocking authorization
almost identically. One project, Remnic Canvas, overlaps two of Keydler's three
pillars: local memory in IndexedDB exposed through WebMCP, surviving across
conversations, where every write is a proposal the human approves, with a live
demo and a public Devpost page.

Persistent memory is six times rarer (11 out of 397), and the direct
competitors on that ground are five or six. Credential opacity also has its
direct analogues.

**Honest position**: nothing in the combination is unoccupied, except the
combination itself and the content model (_completed work, rules to follow,
mistakes not to repeat_). That is what has to go at the top of the writing,
along with the supervision and durability engineering. Not “agent proposes,
human approves”, which a judge who has read fifty entries will have read fifty
times.

## What must NOT be added

A research agent recommended adopting `title`, `getTools()`, `toolchange`,
`additionalProperties: false` and the 1.5k budgets. All five are already in
place. It admitted it had never read the source. Verified:
`src/webmcp/tools.ts` carries thirteen titles, `register.ts:137` calls
`getTools()`, `register.ts:174` listens for `toolchange`, `schemas.ts` has six
`additionalProperties: false`, and `src/domain/budget.ts` holds the budgets.

What survives from that agent, and is verifiable:

- **`exposedTo`** is the only registration option left unused, and it is inert
  on the judging surface, since ChatGPT's browser discovers no iframe tool.
  Adopting it changes nothing a judge could observe.
- **`destructiveHint`, `idempotentHint`, `openWorldHint`, `outputSchema`,
  resources, prompts, sampling, `requestUserInteraction()`** do not exist in
  the WebMCP WebIDL and are silently ignored. Adding them would be noise that a
  judge who writes specifications would notice.

## Two worries we can drop

- **The project predating the contest**: the 97 commits all date from
  August 26 or after, none before the 25th. Nothing to declare.
- **License**: an MIT `LICENSE` at the root. Still to confirm that GitHub shows
  it in the “About” box and that the repository is public. One click, not a
  task.

---

## What could not be established

- **The exact list of fields in the submission form**: both URLs redirect to a
  login page. Log in and look, well before the last day.
- **The number of submissions.** The gallery is not published; the API only
  exposes `registrations_count`. Two contradictory values were seen (3398 and
  1313), one of the two is out of date.
- **Whether “unlisted” satisfies “publicly visible”.** No source. Set it to
  Public.
- **Whether the judges test in ChatGPT's browser, in Chrome 149+, or not at
  all.** Rules and FAQ contradict each other.
- **The content of the Discord** (invitation required) and of the August 25
  opening broadcast.
- **No numeric scoring scale** beyond “four criteria of equal weight”.
- **The competitive landscape is inferred from GitHub metadata, not from
  submissions.** 457 repositories in the window, 60 of them with no
  description, excluded from the counts: a project identical to Keydler may be
  among them. Devpost search blocks robots. The READMEs were read, never the
  code nor the demos: in a ten-day contest, the gap between the two is common.
- **The attrition between repository creation and actual submission** is
  unknown.
