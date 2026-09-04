import type { Tables } from "@/db/database.types";
import type { ContactFacts } from "@/lib/contact-history/facts";

export interface PersonDetailViewProps {
  person: Tables<"people">;
  facts: ContactFacts | null;
}

export type PersonDetailViewMode = "view" | "editing";
