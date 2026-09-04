import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshBanner } from "@/components/hierarchy/RefreshBanner";
import { HierarchyCard } from "@/components/hierarchy/HierarchyCard";
import {
  CONTACT_FACTS_UPDATED_EVENT,
  type ContactFactsUpdatedDetail,
} from "@/components/contact-history/ContactHistorySheet/openContactHistory";
import type { RankingViewModel } from "@/lib/ranking/store";
import type { ContactFacts } from "@/lib/contact-history/facts";
import type { HierarchyViewProps } from "./types";

// KV is eventually consistent (scripts/verify-openai-call.ts documents up to
// a 60s staleness window); the bound below comfortably covers that plus the
// model's own generation time rather than polling forever for a Worker that
// died mid-run.
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

type Status = "fresh" | "refreshing" | "failed";

interface PostRankingsResponse {
  jobId: string | null;
  reason?: string;
}

interface GetRankingsResponse {
  status: "pending" | "done" | "failed";
  ranking?: RankingViewModel | null;
}

function topThreeIds(ranking: RankingViewModel): Set<string> {
  return new Set(ranking.entries.slice(0, 3).map((entry) => entry.person.id));
}

// Polish numeral-noun agreement: 1 -> singular, 2-4 (not 12-14) -> "few" form,
// everything else -> genitive plural. Approximate but correct for the ranges
// this list realistically produces.
function pluralizeCalmTail(count: number): string {
  if (count === 1) {
    return "Pozostała 1 osoba jest spokojna";
  }
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  const useFewForm = lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return `Pozostałe ${String(count)} ${useFewForm ? "osoby są spokojne" : "osób jest spokojnych"}`;
}

/**
 * Owns the interactive behaviour: the stale-on-mount trigger, polling,
 * expanding a collapsed entry, and swapping in a finished ranking. Renders
 * the existing ranking throughout -- never a skeleton over one that already
 * exists. Only a first-ever run with nothing stored shows a loading state.
 */
export function HierarchyView({ initialRanking, staleOnLoad, initialFacts, hasPendingAnswers }: HierarchyViewProps) {
  const [ranking, setRanking] = useState<RankingViewModel | null>(initialRanking);
  const [status, setStatus] = useState<Status>(initialRanking && !staleOnLoad ? "fresh" : "refreshing");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    initialRanking ? topThreeIds(initialRanking) : new Set<string>(),
  );
  const [facts, setFacts] = useState<Record<string, ContactFacts>>(initialFacts);
  const [pendingAnswers, setPendingAnswers] = useState(hasPendingAnswers);

  // A mark's answer lands in the next recompute, never the current one --
  // this handler is the only immediate evidence the loop worked (plan.md's
  // "Critical Implementation Details"). Order is never recomputed locally.
  const applyFactsUpdate = useCallback((personId: string, personFacts: ContactFacts | null) => {
    setFacts((prev) => {
      if (!personFacts) {
        const { [personId]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [personId]: personFacts };
    });
    setPendingAnswers(true);
  }, []);

  // The history sheet (Phase 4) is a separate island -- an edit or delete
  // made there reaches this one only via this broadcast, mirroring how
  // Toaster listens for its own window event.
  useEffect(() => {
    function handleFactsUpdated(event: Event) {
      const { personId, facts: updatedFacts } = (event as CustomEvent<ContactFactsUpdatedDetail>).detail;
      applyFactsUpdate(personId, updatedFacts);
    }
    window.addEventListener(CONTACT_FACTS_UPDATED_EVENT, handleFactsUpdated);
    return () => {
      window.removeEventListener(CONTACT_FACTS_UPDATED_EVENT, handleFactsUpdated);
    };
  }, [applyFactsUpdate]);

  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    },
    [],
  );

  const pollJob = useCallback((jobId: string) => {
    // Defensive: a caller invoking pollJob a second time before the first
    // finishes would otherwise leak the earlier interval -- unreachable
    // today (the refresh button disables while refreshing) but cheap to guard.
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void (async () => {
        try {
          const res = await fetch(`/api/rankings?jobId=${jobId}`);
          const body: GetRankingsResponse = await res.json();
          if (!mountedRef.current) return;

          if (body.status === "done") {
            clearInterval(timer);
            if (body.ranking) {
              setRanking(body.ranking);
              setExpandedIds(topThreeIds(body.ranking));
            }
            setStatus("fresh");
            // The ranking that just landed already incorporates every answer
            // recorded up to this point -- leaving the flag set would keep
            // the banner promising an update that already happened.
            setPendingAnswers(false);
            return;
          }
          if (body.status === "failed") {
            clearInterval(timer);
            setStatus("failed");
            return;
          }
          if (attempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(timer);
            setStatus("failed");
          }
        } catch {
          if (attempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(timer);
            if (mountedRef.current) {
              setStatus("failed");
            }
          }
        }
      })();
    }, POLL_INTERVAL_MS);
    pollTimerRef.current = timer;
  }, []);

  // Fire-and-forget: the caller is responsible for putting the UI into a
  // "refreshing" state beforehand (an event handler does this synchronously;
  // the mount effect below relies on the initial useState value instead, so
  // it never calls setState directly from an effect body).
  const dispatchRefresh = useCallback(
    (force: boolean) => {
      void (async () => {
        try {
          const res = await fetch("/api/rankings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force }),
          });
          const body: PostRankingsResponse = await res.json();
          if (!mountedRef.current) return;

          if (body.reason === "fresh") {
            setStatus("fresh");
            return;
          }
          if (body.jobId) {
            pollJob(body.jobId);
            return;
          }
          setStatus("failed");
        } catch {
          if (mountedRef.current) {
            setStatus("failed");
          }
        }
      })();
    },
    [pollJob],
  );

  function handleManualRefresh() {
    setStatus("refreshing");
    dispatchRefresh(true);
  }

  useEffect(() => {
    if (staleOnLoad) {
      dispatchRefresh(false);
    }
  }, [staleOnLoad, dispatchRefresh]);

  function toggleExpanded(personId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  }

  if (!ranking && status === "refreshing") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="border-border border-t-foreground size-8 animate-spin rounded-full border-2" />
        <p className="text-muted-foreground text-sm">Układamy Twoją kolejność kontaktów…</p>
      </div>
    );
  }

  if (!ranking && status === "failed") {
    return (
      <RefreshBanner
        status="failed"
        createdAt={null}
        peopleConsidered={null}
        peopleTotal={null}
        hasStoredRanking={false}
        hasPendingAnswers={false}
        onRefresh={handleManualRefresh}
      />
    );
  }

  if (!ranking) {
    return null;
  }

  const tailCount = Math.max(0, ranking.entries.length - 3);

  return (
    <div className="flex flex-col gap-4">
      <RefreshBanner
        status={status}
        createdAt={ranking.createdAt}
        peopleConsidered={ranking.peopleConsidered}
        peopleTotal={ranking.peopleTotal}
        hasStoredRanking
        hasPendingAnswers={pendingAnswers}
        onRefresh={handleManualRefresh}
      />

      <div className="flex flex-col gap-3">
        {ranking.entries.map((entry, index) => (
          <HierarchyCard
            key={entry.id}
            entry={entry}
            rank={index + 1}
            expanded={expandedIds.has(entry.person.id)}
            onToggleExpanded={toggleExpanded}
            facts={facts[entry.person.id] ?? null}
            onMarked={applyFactsUpdate}
          />
        ))}
      </div>

      {tailCount > 0 && <p className="text-text-tertiary text-center text-xs">{pluralizeCalmTail(tailCount)}</p>}
    </div>
  );
}
