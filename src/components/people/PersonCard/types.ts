import type { Tables } from "@/db/database.types";
import type { ContactFacts } from "@/lib/contact-history/facts";

export interface PersonCardProps {
  person: Tables<"people">;
  /** Optional so no existing caller breaks -- absent renders no last-contact line. */
  facts?: ContactFacts | null;
}
