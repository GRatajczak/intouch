import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  CONSENT_EVENT,
  readStoredConsent,
  writeStoredConsent,
  type StoredConsent,
} from "@/lib/analytics/consent-storage";
import type { ConsentBannerProps } from "./types";

/**
 * Asks once whether product analytics may run, and nothing loads before "yes".
 *
 * Rendered only while the server's verdict is "unknown" (src/middleware.ts), and
 * visible only while the browser holds no stored choice either. Both answers are
 * offered with equal weight -- a banner that makes refusing harder than
 * accepting is not consent.
 *
 * Two jobs besides asking:
 *  - a choice is written to localStorage and announced on `window`, which is
 *    what AnalyticsRuntime.astro listens to in order to start the SDK;
 *  - when a signed-in user's profile still says "never asked" but the browser
 *    already holds a choice (made before they had an account), that choice is
 *    posted onto the profile. The post is retried harmlessly on later loads: a
 *    404 just means no profile row exists yet.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
  };
}

function getSnapshot(): StoredConsent | "none" {
  return readStoredConsent() ?? "none";
}

// Server and first hydration render nothing, so they agree whatever the browser holds.
function getServerSnapshot(): "pending" {
  return "pending";
}

async function postChoice(choice: StoredConsent): Promise<void> {
  try {
    await fetch("/api/settings/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: choice === "granted" }),
    });
  } catch {
    // Best effort: the browser still holds the choice and the next load retries.
  }
}

export function ConsentBanner({ signedIn }: ConsentBannerProps) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Covers both a choice made just now and one made before the user had an
  // account: whenever a choice is held and somebody is signed in, copy it onto
  // the profile.
  useEffect(() => {
    if (signedIn && (stored === "granted" || stored === "denied")) {
      void postChoice(stored);
    }
  }, [signedIn, stored]);

  function choose(choice: StoredConsent) {
    writeStoredConsent(choice);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
  }

  if (stored !== "none") {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Zgoda na analitykę"
      className="bg-card text-card-foreground border-border fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-lg border p-4 shadow-lg"
    >
      <p className="text-sm font-medium">Czy możemy zbierać anonimową analitykę?</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Chcemy zobaczyć, które strony odwiedzasz i gdzie aplikacja gubi ludzi po drodze. Adresy stron czyścimy przed
        wysłaniem, a nigdy nie wysyłamy imion, opisów ani notatek o Twoich ludziach. Dopóki nie klikniesz „Akceptuję”,
        nic nie jest wysyłane. Zmienisz zdanie w Ustawieniach.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => {
            choose("denied");
          }}
        >
          Odrzucam
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => {
            choose("granted");
          }}
        >
          Akceptuję
        </Button>
      </div>
    </div>
  );
}
