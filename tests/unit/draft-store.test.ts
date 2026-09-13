// test-plan Phase 4, Risk #8: the extracted draft store must round-trip rows
// correctly and clear cleanly, independent of PersonForm (no component-render
// infrastructure needed -- these are plain functions over `localStorage`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_STORAGE_KEY, clearDraftRows, loadDraftRows, saveDraftRows } from "@/lib/people/draft-store";
import type { PersonRowState } from "@/components/people/PersonForm/types";

/** Minimal in-memory Storage double -- jsdom is not part of this repo's test stack. */
function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function row(over: Partial<PersonRowState> = {}): PersonRowState {
  return {
    id: 0,
    name: "Basia",
    relationshipType: "family",
    description: "Ciocia",
    isCollective: "false",
    weight: 8,
    relationshipContext: "",
    contextTags: [],
    lastContactBucket: "",
    ...over,
  };
}

describe("draft-store", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing was ever saved", () => {
    expect(loadDraftRows()).toBeNull();
  });

  it("round-trips a saved row array", () => {
    const rows = [row({ id: 0, name: "Basia" }), row({ id: 1, name: "Celina" })];

    saveDraftRows(rows);

    expect(loadDraftRows()).toEqual(rows);
  });

  it("clears cleanly, and a subsequent load returns null", () => {
    saveDraftRows([row()]);

    clearDraftRows();

    expect(loadDraftRows()).toBeNull();
  });

  it("stores under the documented key", () => {
    saveDraftRows([row()]);

    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
  });
});
