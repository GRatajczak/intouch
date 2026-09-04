import type { ContactFacts } from "@/lib/contact-history/facts";

export interface ContactMarkerProps {
  personId: string;
  rankingEntryId: string | null;
  facts: ContactFacts | null;
  onMarked: (facts: ContactFacts | null) => void;
}
