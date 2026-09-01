import { z } from "zod";

// Values and Polish labels for the ranking's suggested time window, following
// the exact triple in src/lib/validation/profile.ts:11-40. The model picks
// from this fixed set rather than authoring its own phrasing, so the value
// stays sortable for S-04's scheduling and copy never drifts between runs.
// Labels for the first three come straight from the design mock's hierarchy
// section; `no_rush` is this slice's own addition for the calm tail.

export const TIME_WINDOW_VALUES = ["this_week", "two_weeks", "this_month", "no_rush"] as const;
export type TimeWindow = (typeof TIME_WINDOW_VALUES)[number];
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  this_week: "Odezwij się w tym tygodniu",
  two_weeks: "Warto w ciągu 2 tygodni",
  this_month: "W ciągu miesiąca",
  no_rush: "Nie ma pośpiechu",
};
export const TIME_WINDOW_OPTIONS = TIME_WINDOW_VALUES.map((value) => ({
  value,
  label: TIME_WINDOW_LABELS[value],
}));

// .nullable() not .optional() -- OpenAI strict mode requires every property in
// `required`, so a field that may be legitimately absent (contextNote,
// rhythmNote) must be modelled as an explicit null, never an omitted key. See
// plan.md's "Critical Implementation Details".
const entrySchema = z.object({
  personId: z.string(),
  timeWindow: z.enum(TIME_WINDOW_VALUES),
  reason: z.string(),
  contextNote: z.string().nullable(),
  rhythmNote: z.string().nullable(),
});

export const rankingOutputSchema = z.object({ entries: z.array(entrySchema) });

export type RankingOutputEntry = z.infer<typeof entrySchema>;
export type RankingOutput = z.infer<typeof rankingOutputSchema>;
