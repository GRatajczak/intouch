import type { ToastVariant } from "./types";

export const TOAST_EVENT = "app:toast";

export interface ToastEventDetail {
  variant: ToastVariant;
  message: string;
}

/**
 * Fire a toast from any client-side code (e.g. a fetch response handler)
 * without a page navigation. `Toaster` is a separate island, so a DOM event
 * is what connects the two rather than React state/context.
 */
export function showToast(variant: ToastVariant, message: string) {
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { variant, message } }));
}
