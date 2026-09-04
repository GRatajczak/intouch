# Did-It-Happen Feedback Loop — Plan Brief

> Full plan: `context/changes/did-it-happen-feedback-loop/plan.md`

## What & Why

The app already suggests who to reconnect with, but nothing comes back. This slice lets the
user confirm — in one tap, from the screen they are already on — whether a suggested contact
happened, stores that as durable per-person history, and feeds deterministic facts derived
from it into the next ranking. It is roadmap slice `S-03`, the declared north star: the point
where the product's central claim stops being a demo and becomes a loop.

## Starting Point

`S-02` shipped the whole ranking path — owner-scoped `rankings` + `ranking_entries`, a prompt
builder, a background OpenAI run, and the `/dashboard` island that renders it. What it
deliberately left open is exactly this slice's job: there is **no contact-history table of any
kind**, no column anywhere holds an answer, and `src/lib/ranking/prompt.ts:56` currently
instructs the model *not to mention contact history at all* — the correct rule while none
existed, and the single line this slice must rewrite.

## Desired End State

Every hierarchy card offers `Tak, rozmawialiśmy` / `Jeszcze nie`. One tap records the answer;
the card confirms in place, shows a freshly-rendered `Ostatni kontakt` chip, offers an optional
note, and the banner states the order will update on the next recompute. When that recompute
runs, the model has seen how long the silence has been and whether the last attempt failed, and
the order and its `Dlaczego teraz` text reflect it. `/people` shows last-contact per person, and
a history sheet lists every recorded event with edit and delete.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| When the app asks | Always-available marker; the card escalates once the suggested window has elapsed | The reminder that would supply FR-009's "intended date" is `S-04` and still blocked, and the roadmap's named risk here is friction — the north-star criterion has to be reachable in the first session |
| Storage | New person-centric `contact_events` table, with a nullable `ranking_entry_id` for provenance | `ranking_entries` is replaced on every recompute, while `FR-005` requires history to survive a person's deactivation |
| Feedback path | Code computes hard facts, injects them as structured prompt fields; the model still does the ranking | A chip must never be able to hallucinate a date — the same rule `S-02` set when it made time windows enum buckets rather than model prose |
| Recompute on marking | None — the existing 24h stale-on-view rule and `Przelicz teraz` stay the only triggers | Zero added OpenAI spend per tap, and marking three people in a row cannot queue three runs |
| What "Jeszcze nie" means | A failed attempt that **raises** urgency; no snooze | Matches `US-01` verbatim ("time since the last (un)successful contact") and the design's own use of a failed attempt as an urgency factor |
| Immediate feedback | Card confirms in place + a banner line promising the next recompute | With no recompute on marking, this is the *only* evidence the loop worked — drop it and the tap looks broken |
| Optional note | Ships, revealed after the answer, and reaches the prompt | Zero friction on the required action while capturing the richest signal the app can get; it is also the only way the AI learns anything after a person is added |
| Timing | `occurred_at` is always server time at marking, in a real `timestamptz` column | One tap, no decisions — a backdating picker stays a purely additive change later |
| History surface | One sheet island mounted in `Layout.astro`, opened by a `CustomEvent` from either surface | Full editing needs a list, but `/people/[id]` belongs to `S-05`; a single island reuses the documented `Toaster` seam instead of hydrating every card |
| Undo | Full edit and delete on any recorded event | Chosen over a time-boxed undo; the current `Toaster` has no action slot anyway |
| Cascades | `ON DELETE CASCADE` on **both** `owner_id` and `person_id` | The PRD's erasure NFR is binary and a note is free text about a third party; `FR-005`'s retention promise is about deactivation, which touches no rows |
| Verification | New `scripts/verify-feedback-loop.ts` against a deployed Worker | Follows the three existing `tsx` script precedents; `lessons.md` is explicit that a local run proves nothing about production limits |

## Scope

**In scope:** the `contact_events` table with owner-scoped RLS; a derived-facts module; create,
list, edit and delete endpoints; history facts in the ranking prompt; the marker, chips and
confirmed state on the hierarchy card; the `RefreshBanner` promise line; a per-person history
sheet; a last-contact line on `/people`; an end-to-end verification script.

**Out of scope:** reminders and reminder settings (`S-04`); user-declared intent
(`Zaplanowałam kontakt`) and any due date; snooze (`Odłóż o tydzień`); any recompute triggered
by marking; `/people/[id]` (`S-05`); backdating UI; person edit / deactivate / delete (`S-05`);
categories (`FR-006`); a test framework; any change to the model or the ranking output schema.

## Architecture / Approach

One append-only-by-default table, read through exactly one module —
`src/lib/contact-history/facts.ts` — which folds raw events into a per-person `ContactFacts`
object (days since the last successful contact, whether the last attempt failed, failures
since, recent notes). That module has two consumers: the prompt builder, which serializes the
facts into the model input, and the UI, which renders the chips. Both read the same derived
values, so a chip can never disagree with what the model was told. The model's job is
unchanged — it still ranks and still writes `reason`; nothing about the order is computed in
code, so `US-01`'s claim that context breaks ties stays the model's to keep.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, facts, write path | `contact_events` + RLS, regenerated types, facts module, `POST` + note-attaching `PATCH` | A foreign key is not an authorization check — `person_id` must be verified against the caller, since RLS does not apply to FK validation |
| 2. History reaches the ranking | Facts threaded into the prompt; the fabrication prohibition narrowed, not deleted | Deleting the prohibition outright reopens the hallucinated-history risk it was written to close |
| 3. Marker on the hierarchy card | The north-star screen: two buttons, note, chips, confirmed state, banner line | Visible UI cannot be proved by `astro check`/lint/build — `S-06` shipped three phases broken that way |
| 4. History sheet + catalog line | Sheet primitive, list/edit/delete endpoints, `/people` last-contact | Scope drift toward the `/people/[id]` page `S-05` owns |
| 5. Production verification | `verify-feedback-loop.ts` + a written verification record | A silent `wrangler tail` means unsynced non-versioned settings, not missing traffic |

**Prerequisites:** `S-02` (done) — its `rankings` tables, prompt builder and `/dashboard` island
are all extended here. A local Supabase for `db reset` / `verify:rls`, a deployed preview plus
two confirmed hosted accounts for phase 5, and the existing `OPENAI_API_KEY` secret.

**Estimated effort:** ~4–5 sessions across five phases; phases 3 and 4 carry the most UI work.

## Open Risks & Assumptions

- **The behavioural risk is the real one.** The roadmap says so explicitly: if the marker is not
  frictionless, the loop stays empty and the hierarchy goes permanently stale. Nothing in the
  plan proves people will tap it.
- **No recompute on marking is a deliberate trade.** It costs nothing and cannot thrash, but it
  means the ordering does not visibly react until the next recompute — which is why the
  confirmed state and the banner line are treated as load-bearing rather than polish.
- **"Ranking visibly reacted" is verified by inspection.** Because the order stays the model's
  to decide, there is no deterministic assertion that a given answer moves a given person —
  only that the facts reached the prompt and that the reasons cite them.
- **`occurred_at` records confirmation time, not conversation time.** Someone confirming a week
  late skews recency slightly optimistic — harmless at bucket-level time windows.
- **Notes are a new untrusted input surface** reaching the model; bounded at 200 chars, capped
  at two per person, and kept inside a labelled history block.
- **`FR-005` interaction assumed, not built.** History is designed to survive deactivation, but
  no `is_active` column exists yet — `S-05` must honour that when it adds one.

## Success Criteria (Summary)

- A user can confirm a suggested contact in one tap and immediately see the answer reflected on the card.
- A recompute after that answer produces a ranking whose reasons cite the recorded history — the PRD's primary success criterion ("mark at least one contact as successfully done") is reachable in a single session.
- Recorded history remains visible and editable per person, and is never readable by another account.
