import type { PersonRowState } from "@/components/people/PersonForm/types";

// Extracted from PersonForm.tsx (test-plan Phase 4, Risk #8) so the store's
// behavior is unit-testable without component-rendering infrastructure this
// repo doesn't have. No behavior change from the version that lived privately
// in PersonForm.tsx.
export const DRAFT_STORAGE_KEY = "intouch:add-person-draft";

// A draft is per-viewer convenience, not durable state -- any read/write
// failure (private browsing, storage disabled, corrupt JSON) is swallowed
// and simply falls back to no draft, never surfaced to the user.
export function loadDraftRows(): PersonRowState[] | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as PersonRowState[];
  } catch {
    return null;
  }
}

export function saveDraftRows(rows: PersonRowState[]) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore -- see loadDraftRows
  }
}

export function clearDraftRows() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore -- see loadDraftRows
  }
}
