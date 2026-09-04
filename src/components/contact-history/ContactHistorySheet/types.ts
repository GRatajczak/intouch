import type { Tables } from "@/db/database.types";

export type ContactHistorySheetState =
  | { kind: "closed" }
  | { kind: "loading"; personId: string; personName: string }
  | { kind: "loaded"; personId: string; personName: string; events: Tables<"contact_events">[] }
  | { kind: "error"; personId: string; personName: string; message: string };

export type ContactHistoryRowMode = "view" | "editing" | "confirmingDelete";
