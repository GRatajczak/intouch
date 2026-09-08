# Decay-Driven Reminders (S-04) — Plan Brief

> Full plan: `context/changes/decay-driven-reminders/plan.md`

## What & Why

Build the daily sweep that emails a user, unprompted, about the relationship
that has gone quietest — one hero person per email, ordered by the hierarchy
`S-02`/`S-03` already produce. This is the vision's most distinctive promise
("the app decides on your behalf") and the last must-have FR still unbuilt. It
was `blocked` on one decision — the cadence rule — which this planning session
resolved, closing PRD Open Questions 3 and 4.

## Starting Point

`F-04` proved the Worker can send email on a schedule: `src/worker.ts` exports
`scheduled`, a real Cron Trigger fires it daily, and a Resend client plus a
branded email shell exist. It deliberately built no Supabase access from that
handler, no reminder logic, and no sending identity beyond `onboarding@resend.dev`
— which Resend delivers only to the account owner's own inbox. Meanwhile every
RLS policy in the schema is `auth.uid() = owner_id`, so a cron with no session
reads exactly zero rows, and nothing anywhere records that an email was sent.

## Desired End State

At 06:00 UTC (08:00 in Poland) the Worker asks Postgres which users are eligible,
refreshes any of *those* users' stale rankings, picks the single most urgent
person from each, and sends one branded email from
`przypomnienia@mail.get-in-touch.pl` — hero person, a "Dlaczego akurat teraz"
factor list built from real data, and a two-line "W kolejce" teaser. Every send
writes a `reminder_sends` row, so "did this user get an email today" is a SQL
query. A user who switched reminders off is never contacted; a user with nothing
urgent gets silence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Cadence trigger | Urgency gate + 3-day per-user cooldown | Decay-driven means silence when nothing is urgent; the cooldown is the anti-spam brake FR-008 asked for, and the NFR's once-per-day is a ceiling above it |
| Email content | One hero + 2-line queue teaser | One clear CTA drives the FR-009 loop, while the teaser proves the app is watching more than one relationship — a full digest gets read and dismissed |
| Anti-nag | Keep nudging until confirmed | The most urgent relationship never falls off the radar; the cooldown, not rotation, is what stops it becoming daily |
| Ranking freshness | Refresh stale rankings inside the sweep, capped per run | The target persona never opens the app, so their ranking is always stale — skipping them would mean the feature never fires for the people it exists for |
| Cross-owner reads | Service-role client in one module + narrow `SECURITY DEFINER` RPCs | RLS stays intact on every request path; the bypass is one auditable surface with a fixed return shape, not a blanket `select *` |
| Send state | A `reminder_sends` table, one row per email | One table enforces the cooldown, makes the once-a-day NFR queryable, and satisfies "delivery outcomes must be observable" |
| Sender | Verified subdomain `mail.get-in-touch.pl` | Closes the `lessons.md` gap and keeps transactional reputation off the apex domain serving the site |
| Email CTAs | Plain deep links into the app | No unauthenticated mutation endpoint; honours the PRD non-goal and lands the user where S-03's confirmation UI already is |
| Settings | On/off toggle only | A kill switch is non-negotiable; a frequency slider hands the deciding back to the user, which is the opposite of the product's claim |
| Follow-up email | Out of scope | The mock's "czy się udało?" is a different trigger, and S-03's in-app prompt already closes the loop |
| Schedule | Single cron at `0 6 * * *` | 08:00 CEST for a Poland-only user base, one trigger against a free-tier cap of five |
| Verification | Vitest on the rules + a dry-run sweep script | The rules hold the bugs and need no infrastructure; the dry run reads end-to-end in seconds instead of a 24h wait |

## Scope

**In scope:** verified sending domain and `REMINDER_FROM`; the repo's first
service-role client, confined to one module; `reminder_sends` +
`profiles.reminders_enabled` + two `SECURITY DEFINER` RPCs; pure decision rules
with a vitest suite; the reminder email template; the sweep and its dry-run
script; an on/off toggle on `/settings`; production verification.

**Out of scope:** the "czy się udało?" follow-up email; one-click action tokens;
user-facing frequency control; per-person hero rotation; timezone/per-user send
hour; any change to the ranking prompt or `time_window` semantics; a reminder
history UI.

## Architecture / Approach

```
cron 06:00 UTC → worker.ts scheduled → runReminderSweep()
    │
    ├─ reminder_candidates(cooldown, max)   ← the ONLY cross-owner query
    │      (SECURITY DEFINER, service_role only, fixed return shape)
    │
    └─ per candidate, own try/catch:
         loadLatestRanking → stale? runRanking (OpenAI) → reload
         loadContactFacts
         selectHero  → null ⇒ silence, no row written
         renderReminderEmail → resend.emails.send
         record_reminder_send('sent' | 'failed')
```

Three ideas carry it. **The RPC decides whose data may be touched**, then every
read is scoped to one named `ownerId` through the existing helpers, which already
carry explicit `owner_id` filters. **Gate before you spend** — the cooldown check
is a single round trip and runs before any OpenAI call, capping AI spend at the
users who could actually receive mail today. **The decision rules are pure
functions**, which is why they can be written test-first and need no database.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Sending identity & config | Verified domain, two new secrets, admin client module, cron at 06:00 UTC | DNS verification has an external lead time — start it before writing code |
| 2. Schema | `reminder_sends`, `reminders_enabled`, two `SECURITY DEFINER` RPCs | A `SECURITY DEFINER` function without `set search_path = ''` is a privilege-escalation hole |
| 3. Decision logic (TDD) | Cooldown, urgency gate, hero selection, factor building + vitest suite | Asserting against the implementation instead of the PRD would produce a mirror test |
| 4. Email template | The mock's hero email, built from real data | Automated checks cannot prove an email renders — needs a human look |
| 5. The sweep | End-to-end wiring, per-user failure isolation, dry-run script | First OpenAI call in a no-user context; production limits are not what `astro dev` shows |
| 6. Settings toggle | `reminders_enabled` control replacing the stub card | Small, but another phase whose success criteria need a human look |
| 7. Production verification | Real send, real inbox, real `reminder_sends` row | No mechanism fires a cron on demand — the temporary tight interval must *replace* the daily entry, not join it |

**Prerequisites:** `S-03` (done), `F-04` (done). Ownership of `get-in-touch.pl`
DNS, and a Resend account able to add a sending domain — both already held.

**Estimated effort:** ~2–3 sessions across 7 phases. Phases 2–6 are code; phase 1
is mostly configuration and phase 7 is entirely operational.

## Open Risks & Assumptions

- **`ranking-recency-floor` is in flight and overlaps.** That change reworks how
  `time_window` is decided (a deterministic floor tied to `daysSinceLastHappened`),
  and phase 3's urgency gate reads exactly those values. If it lands first, the
  gate becomes more trustworthy; if it lands after, phase 3's tests may need their
  fixtures revisited. Neither blocks the other, but they should not be implemented
  by two agents in the same working tree at once.
- **The two cadence constants are judgement, not data.** `REMINDER_COOLDOWN_DAYS = 3`
  and the `this_week`/`two_weeks` urgency set are defensible defaults with nothing
  behind them yet. `F-06` (PostHog) exists partly to replace that judgement with a
  number; both are named constants so retuning is one edit.
- **This introduces the repo's first RLS bypass.** The mitigations are structural
  (one module, narrow RPCs with fixed return shapes, `revoke execute` from
  `authenticated`), but nothing mechanically prevents a future import of
  `supabase-admin.ts` from elsewhere. Worth a lint rule or a `lessons.md` entry
  once it lands.
- **Assumption: cron handlers have enough CPU headroom for an OpenAI call.** True
  in principle — cron gets far more than the 10ms request limit and the wait is
  I/O — but `lessons.md` is explicit that this is only established by observing
  production, which is phase 7's job.

## Success Criteria (Summary)

- A real reminder email arrives, unprompted, in a real inbox — from a verified
  domain, naming the person the dashboard's hierarchy also puts first.
- A second sweep inside the cooldown window sends nothing and writes no row, and
  a user who switched reminders off is never a candidate at all.
- Every send outcome, including failures, is a queryable `reminder_sends` row
  rather than a line in a log nobody reads.
