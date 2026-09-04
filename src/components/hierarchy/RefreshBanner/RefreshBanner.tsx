import { CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RefreshBannerProps } from "./types";

function formatComputedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) {
    return `dziś o ${time}`;
  }
  const day = date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
  return `${day} o ${time}`;
}

export function RefreshBanner({
  status,
  createdAt,
  peopleConsidered,
  peopleTotal,
  hasStoredRanking,
  hasPendingAnswers,
  onRefresh,
}: RefreshBannerProps) {
  // Nothing has ever been computed and the one attempt so far failed -- this
  // is the whole view, not a strip above a card list that doesn't exist yet.
  if (status === "failed" && !hasStoredRanking) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <TriangleAlert className="text-destructive size-10" />
        <h2 className="text-foreground text-lg font-semibold">Nie udało się wygenerować kolejności</h2>
        <p className="text-muted-foreground max-w-sm text-sm">
          Spróbuj jeszcze raz za chwilę. Jeśli problem się powtarza, daj nam znać.
        </p>
        <Button onClick={onRefresh}>Spróbuj ponownie</Button>
      </div>
    );
  }

  const isTruncated = peopleConsidered !== null && peopleTotal !== null && peopleConsidered < peopleTotal;

  return (
    <div className="border-border bg-muted flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {status === "refreshing" ? (
          <RefreshCw className="text-muted-foreground size-4 flex-shrink-0 animate-spin" />
        ) : status === "failed" ? (
          <CircleAlert className="text-destructive size-4 flex-shrink-0" />
        ) : (
          <RefreshCw className="text-muted-foreground size-4 flex-shrink-0" />
        )}
        <div>
          {status === "refreshing" && (
            <div className="text-foreground text-sm font-semibold">Aktualizujemy kolejność…</div>
          )}
          {status === "failed" && hasStoredRanking && (
            <>
              <div className="text-foreground text-sm font-semibold">Nie udało się odświeżyć kolejności</div>
              <div className="text-muted-foreground text-xs">Pokazujemy poprzednią wersję poniżej.</div>
            </>
          )}
          {status === "fresh" && createdAt && (
            <>
              <div className="text-foreground text-sm font-semibold">Kolejność odświeżona</div>
              <div className="text-muted-foreground text-xs">
                {formatComputedAt(createdAt)}, na podstawie {peopleConsidered}{" "}
                {peopleConsidered === 1 ? "osoby" : "osób"}
                {isTruncated && ` (z ${String(peopleTotal)} łącznie)`}
              </div>
              {hasPendingAnswers && (
                <div className="text-muted-foreground text-xs">
                  Twoje odpowiedzi trafią do kolejności przy następnym przeliczeniu.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={status === "refreshing"}
        className="flex-shrink-0"
      >
        {status === "failed" ? "Spróbuj ponownie" : "Przelicz teraz"}
      </Button>
    </div>
  );
}
