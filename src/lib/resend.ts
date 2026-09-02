import { Resend } from "resend";
import { RESEND_API_KEY } from "astro:env/server";

export function createResendClient() {
  if (!RESEND_API_KEY) {
    return null;
  }
  return new Resend(RESEND_API_KEY);
}
