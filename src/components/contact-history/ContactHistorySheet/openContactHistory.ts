import type { ContactFacts } from "@/lib/contact-history/facts";

export const CONTACT_HISTORY_OPEN_EVENT = "app:contact-history:open";
export const CONTACT_FACTS_UPDATED_EVENT = "app:contact-history:facts-updated";

export interface ContactHistoryOpenDetail {
  personId: string;
  personName: string;
}

export interface ContactFactsUpdatedDetail {
  personId: string;
  facts: ContactFacts | null;
}

/**
 * Opens the single ContactHistorySheet instance mounted in Layout.astro.
 * Mirrors Toaster/toast.ts's showToast -- the sheet is a separate island, so
 * a DOM event is what connects a caller to it, not React state or context.
 */
export function openContactHistory(personId: string, personName: string) {
  window.dispatchEvent(
    new CustomEvent<ContactHistoryOpenDetail>(CONTACT_HISTORY_OPEN_EVENT, { detail: { personId, personName } }),
  );
}

/**
 * Broadcasts a person's freshly recomputed facts after any contact_events
 * mutation made from the sheet, so a hierarchy card -- itself a separate
 * island -- can refresh its chips without a refetch.
 */
export function broadcastContactFactsUpdate(personId: string, facts: ContactFacts | null) {
  window.dispatchEvent(
    new CustomEvent<ContactFactsUpdatedDetail>(CONTACT_FACTS_UPDATED_EVENT, { detail: { personId, facts } }),
  );
}
