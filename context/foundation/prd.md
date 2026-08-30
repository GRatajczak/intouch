---
project: "InTouch"
version: 2
status: draft
created: 2026-07-19
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

People living at a constant pace lose touch with the people who matter to them —
family, friends, close acquaintances — not by choice but by attrition. The
relationship slides off the bottom of the priority list under a pile of
obligations, and the person only notices when it is already too late: "it's been
a year since I spoke with my family in the mountains." The pain is felt in the
moment of realization, and its cost is a weakened relationship that no calendar
entry ever flagged.

The insight: a plain calendar or phone reminder is too blurry to monitor who you
last actually contacted. This product keeps a lightweight knowledge base about a
person's close ones and proactively surfaces the relationships that are going
quiet — so the user is nudged *before* neglect sets in, not after they happen to
remember. The value is not "set yourself a reminder"; it's the app deciding, on
the user's behalf, which relationships need attention now.

## User & Persona

**Primary persona — the person living in constant rush.** A busy adult with a
large network of family, friends, and acquaintances and a heavy load of
day-to-day obligations. They genuinely care about staying in touch, but their
pace of life pushes relationships out of view until a gap has already opened
(e.g., a year without contact with distant family). They are not defined by age
or profession but by the trait that binds them: their tempo of life crowds out
relationship maintenance. The MVP serves this persona managing their own
relationships — "everyone who lives in constant rush," narrowed to the person
tending their own circle.

## Success Criteria

The end-to-end flow that must work: the user creates an account and signs in;
adds people, each with a description and a relationship weight (1–10); the app
analyzes the descriptions, weights, and relationship context and proposes a
ranked hierarchy of who to reconnect with; the user receives a reminder driven
by that hierarchy and reaches out themselves; and after the intended date the
app asks "did it happen?" and records a yes/no marker that feeds subsequent
reminders. Calendar integration is explicitly deferred to v2 — see Non-Goals.

### Primary
- A user completes the end-to-end flow: they receive a sensible AI-proposed
  contact hierarchy and mark at least one contact as successfully done. If a
  user can go from "added my people" to "acted on a suggested contact and
  confirmed it," the product worked.

### Secondary
- A user schedules/initiates at least one contact thanks to the app within the
  first 30 days of use. (Nice signal of real-world pull, but not sufficient on
  its own.)

### Guardrails
- **Privacy of the knowledge base about close ones.** The app stores personal
  information about third parties (the user's family and friends); this data
  must not leak or be exposed to other users. A breach here is a regression even
  if the flow works.
- **Quality / relevance of AI suggestions.** The proposed hierarchy must be
  sensible — nonsensical or obviously wrong suggestions break user trust and
  make the core feature worthless even if everything else works.

## User Stories

### US-01: User receives an AI-proposed contact hierarchy

- **Given** a logged-in user who has provided a self-profile and added at least one person with a description and a weight
- **When** they open / request the contact hierarchy
- **Then** they see a ranked order of "who to reconnect with," reflecting weights AND relationship context, where each entry carries a suggested time window for reaching out (e.g. "worth contacting Maciej within 2 weeks")

#### Acceptance Criteria
- When two people share the same weight (e.g. both 8), their order is decided by the context from their descriptions — they are not treated identically.
- Each hierarchy entry shows a suggested time window for reaching out.
- A user with no people added sees an explanatory empty state, not an error or empty list.
- The hierarchy takes into account time since the last (un)successful contact from the feedback loop.

## Functional Requirements

### Profile & close ones

- FR-001: User can create an account and sign in. Priority: must-have
  > Socrates: Counter-argument considered: "login is friction before any value; a busy user may abandon at signup — could it be local-first with no account?" Resolution: kept, and login is mandatory — (1) security of sensitive third-party data, (2) control of AI costs (no anonymous/free-for-all usage).
- FR-002: User can provide a self-profile via a short structured form (selectable fields + short inputs, not pure free text) so the AI has clean context about who is asking. Priority: must-have
  > Socrates: Counter-argument considered: "another onboarding step before value; users fill free text lazily, so the AI gets weak context anyway." Resolution: revised — changed from free-text description to a short structured form so it stays quick to fill and gives the AI cleaner signal.
- FR-003: User can add a person via a short structured form (short inputs for who they are, what they like/value) plus a single-vs-collective marker; when the entry is a collective, its identity (e.g. "part of the family from the mountains") is carried in that same structured description. Priority: must-have
  > Socrates: Counter-argument considered: "free-text descriptions are effort; busy users leave them blank, starving the AI of the differentiating context." Resolution: revised — replaced pure free-text with a structured form to lower effort and improve data quality; single-vs-collective field retained. Narrowed from an originally-considered free-text collective label to a two-option marker, keeping one less field on a form the persona is expected to abandon if it grows; the collective's identity rides in the description, which the AI already reads for the tie-breaking context US-01 depends on.
- FR-004: User can assign a relationship weight (1–10) to a person. Priority: must-have
  > Socrates: Counter-argument considered: "if everyone important gets a 10, the scale collapses to all-10s and loses signal." Resolution: kept — context resolves ties (see US-01); weight is one signal among several, and the collapse risk is acceptable. Widened from an originally-considered 1–5 to 1–10 to give the scale more discriminating room before ties become common.
- FR-005: User can edit a person, deactivate them (AI stops considering a deactivated person while their data — including contact history — is retained), and delete them; deletion is available only after deactivation. Priority: must-have
  > Socrates: Counter-argument considered: "deleting a person loses their contact/feedback history that feeds the hierarchy." Resolution: revised — added a deactivate step before delete: user first deactivates (excluded from AI, data retained), and can delete only afterward.
- FR-006: User can organize people into categories/tabs (e.g. family, friends, neighbors) for easier browsing. Priority: nice-to-have
  > Socrates: Counter-argument considered: "since the AI already ranks everyone, browsing tabs may be redundant clutter." Resolution: kept as nice-to-have — organizational only, does not touch the AI logic.

### Hierarchy & reminders

- FR-007: User can receive an AI-proposed contact hierarchy/order, computed from the self-profile + people descriptions + weights + who-is-who context. Each entry carries a suggested time window for reaching out (e.g. "worth contacting Maciej within 2 weeks"). Priority: must-have
  > Socrates: Counter-argument considered: "suggested time windows may feel arbitrary; if the user can't see why '2 weeks', trust erodes." Resolution: kept — flagged as a quality risk tied to the AI-relevance guardrail; suggestions must be explainable enough to trust (design concern, no FR change).
- FR-008: User receives reminders aligned with that hierarchy, delivered as email to the address on their account. Priority: must-have
  > Socrates: Counter-argument considered: "too-frequent reminders become notification spam and get muted, killing the proactive value." Resolution: kept — reminder cadence must be restrained; routed to Open Questions as a cadence decision.
- FR-009: User can mark whether a contact/meeting happened (yes/no) after its intended date, which feeds subsequent reminders. Priority: must-have
  > Socrates: Counter-argument considered: "users won't bother marking did-it-happen, leaving the loop empty and the hierarchy stale." Resolution: kept — core to the learning loop; making the marker frictionless is a design concern.

## Non-Functional Requirements

- Personal data about the user's close ones — people who are not themselves
  users of the app — is never visible to any other user, and deleting a person's
  data is fully and irreversibly honored. (binary; GDPR-adjacent)
- Generating the AI hierarchy never blocks the user: they may leave or close the
  view while it runs, and are notified when the result is ready.
  (outside-observable commitment)
- Reminders reach the user at most once per day, and address relationship decay
  (close ones the user has not contacted in a long time) — not same-day calendar
  events, which are out of MVP scope.
- Reminders are delivered by **email**, to the address the user signed up with.
  Email is the only reminder channel in the MVP — no web push, no SMS, no
  in-app-only notification counts as satisfying FR-008. Sending goes through a
  transactional email provider (**Resend**), which makes it a server-side
  outbound call from a verified sending domain, never a client-side send. A
  reminder that fails to send is a failure of FR-008, so delivery outcomes must
  be observable rather than fire-and-forget.
- The product is usable in a current mainstream desktop/mobile web browser.
  (Native mobile app is a future extension, not part of the MVP.)

## Business Logic

The app decides, from the user's self-profile and the descriptions, weights and
context of the user's close ones, whom to reconnect with and within what time
window — and ranks those people in order of importance/urgency.

The rule consumes user-facing inputs: the user's own short self-profile; for
each close one, a structured description (who they are, what they like or value)
and whether they are a single person or a collective; a relationship weight from
1 to 10; and the running history of whether previously suggested contacts
actually happened. Weight alone is deliberately not enough — when several people
share the top weight, the descriptive context breaks the tie.

The output is a ranked hierarchy of people, each entry carrying a suggested time
window for reaching out (e.g. "worth contacting Maciej within 2 weeks"). The
user encounters it as the app's main view, is nudged toward it through reminder
emails aligned with the ranking, and after each suggested date confirms whether the
contact happened — that confirmation feeds back into future rankings so the
hierarchy stays current rather than going stale.

## Access Control

Each user signs in to their own account; relationship data persists across the
user's sessions and devices so it can drive proactive reminders (and, later,
calendar features) even when the user is not actively in the app. The model is
**flat** — every user is equal and can see
and manage only their own circle of close ones. There are no roles (no admin /
member / guest) in the MVP. An unauthenticated visitor has no access to any
relationship data. The specific sign-in mechanism is deferred to the downstream
stack-selection step.

## Non-Goals

Scope avoids surfaced during shaping:

- **No calendar integration** — no reading availability or writing events to a
  calendar; deferred to v2. Reminders concern weakening relationships, not
  same-day events.
- **No native mobile app** — the MVP is web-only; a native mobile app is a
  future extension.
- **No event/meeting scheduling** — the app does not book meetings or propose a
  concrete date/time; it only suggests a time window ("within 2 weeks") and the
  user initiates contact themselves.

Non-goals carried over from the original idea:

- **No photos** — the app stores no images of people.
- **No automatic contact detection** — people are added manually; the app does
  not scan the phone/address book.
- **No social network** — this is a private personal tool, not a shared social
  graph.
- **No chat / messaging** — the app does not send messages on the user's behalf;
  the user reaches out through their own channels. This is not in tension with
  the reminder emails of FR-008: those are the app writing *to the user* about
  their own circle. No message ever leaves the user's account addressed to a
  close one, and close ones' email addresses are not collected at all.
- **No inbound email** — reminder emails are one-way. The app does not receive,
  parse, or act on replies; confirming "did it happen?" (FR-009) happens in the
  app, not by replying to a reminder.
- **No gamification** — no points, streaks, or badges in the MVP.

## Open Questions

1. **AI-suggestion explainability** — how much of the "why this order / why this time window" should be shown so users trust the hierarchy? Ties to the AI-relevance guardrail. Owner: user, during design.
2. **Structured-form fields** — exact fields for the self-profile (FR-002) and per-person form (FR-003) are not yet pinned. Owner: user, during design.
3. **Reminder cadence** — how frequently reminders fire without becoming spam that users mute (bounded by the "at most once per day" NFR, but the decay-driven trigger logic is unresolved). Owner: user, during design. Routed from FR-008.
4. **Reminder email content** — does one email carry the single most urgent person, the top few, or the whole hierarchy? This decides whether the email is a nudge that pulls the user into the app or a digest they can read and dismiss without ever opening it — which in turn decides whether the FR-009 confirmation loop gets fed. Owner: user, during design. Routed from FR-008.
