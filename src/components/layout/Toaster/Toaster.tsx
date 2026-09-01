import { useEffect, useState } from "react";
import { CircleCheck, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOAST_EVENT, type ToastEventDetail } from "./toast";
import type { ToastMessage, ToastVariant } from "./types";

const TOAST_DURATION_MS = 5000;

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-success-bg text-success border-success/20",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};

const variantIcon: Record<ToastVariant, typeof CircleCheck> = {
  success: CircleCheck,
  error: CircleAlert,
};

let nextToastId = 0;

/**
 * Two ways to trigger a toast: a `notice`/`error` query param present on
 * mount (for flows that redirect between pages -- stripped from the URL
 * after reading so a refresh doesn't re-show it), or the `showToast` helper
 * fired from client-side code on the same page (for fetch-based flows with
 * no navigation). Mounted once in Layout.astro so any page can use either.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const notice = url.searchParams.get("notice");
    const error = url.searchParams.get("error");
    if (!notice && !error) return;

    const found: ToastMessage[] = [];
    if (notice) found.push({ id: nextToastId++, variant: "success", message: notice });
    if (error) found.push({ id: nextToastId++, variant: "error", message: error });

    // This can't move to the initial useState value: the server render (and
    // the client's first hydration pass) must produce an empty toast list to
    // match, since `window.location` doesn't exist during SSR. Setting state
    // here, after mount, is what makes that first render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToasts((prev) => [...prev, ...found]);
    url.searchParams.delete("notice");
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    function handleToastEvent(e: Event) {
      const { variant, message } = (e as CustomEvent<ToastEventDetail>).detail;
      setToasts((prev) => [...prev, { id: nextToastId++, variant, message }]);
    }
    window.addEventListener(TOAST_EVENT, handleToastEvent);
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToastEvent);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, TOAST_DURATION_MS),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = variantIcon[toast.variant];
        return (
          <div
            key={toast.id}
            className={cn(
              "shadow-card flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              variantStyles[toast.variant],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => {
                setToasts((prev) => prev.filter((t) => t.id !== toast.id));
              }}
              aria-label="Zamknij powiadomienie"
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
