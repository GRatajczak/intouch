-- Slice S-09: self-profile rhythm fields feeding S-02's ranking prompt and
-- S-04's reminder copy. Values and Polish labels re-derived from the
-- onboarding card in .ai/intouch-design-preparation/project/InTouch.dc.html
-- (~lines 105-128 -- the three pill-selector groups: weekly time budget,
-- preferred channels, availability windows).
--
-- All three columns are optional per change.md's planning decision -- the
-- form does not require them and profiles filled before this slice must
-- keep working (CLAUDE.md forward-compatibility rule). The scalar column
-- models "no answer" as NULL; the two array columns model it as an empty
-- array (deliberately left inconsistent -- see plan.md's "What We're NOT
-- Doing"). No GRANT changes -- the table-level grant from
-- 20260830101704_add_profiles_and_people_fields.sql already covers new
-- columns on public.profiles. No RLS changes -- policies are row-level.

alter table public.profiles
  add column weekly_time_budget text
    check (weekly_time_budget in ('under_1h', 'hours_1_3', 'over_3h')),
  add column preferred_channels text[] not null default '{}'
    check (preferred_channels <@ array['phone', 'message', 'in_person', 'video']::text[]),
  add column availability_windows text[] not null default '{}'
    check (availability_windows <@ array['weekday_morning', 'weekday_evening', 'weekend']::text[]);

comment on column public.profiles.weekly_time_budget is
  'How much time the user realistically has per week for reaching out to people -- one of under_1h / hours_1_3 / over_3h, or null if unanswered. Feeds S-02''s ranking prompt and S-04''s reminder cadence.';

comment on column public.profiles.preferred_channels is
  'Ways the user prefers to reach out -- any of phone / message / in_person / video, empty if unanswered. Feeds S-02''s ranking prompt and the channel named in S-04''s reminder copy.';

comment on column public.profiles.availability_windows is
  'When in the week the user usually has space to reach out -- any of weekday_morning / weekday_evening / weekend, empty if unanswered. Feeds the time window S-02 suggests and S-04''s reminder scheduling.';
