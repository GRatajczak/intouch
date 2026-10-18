/**
 * Facts the privacy policy (src/pages/privacy.astro) states about the
 * controller. Kept in one place so a name or address change is a one-line edit,
 * and so it is obvious what the page needs from a human.
 *
 * These are NOT secrets and NOT config -- they are published verbatim on a
 * public page, which is why they are constants rather than `astro:env` fields.
 *
 * Art. 13(1)(a) GDPR requires the controller's identity and contact details.
 * Keep them real: the page is the controller's legal identification.
 */
export const CONTROLLER_NAME = "Grzegorz Ratajczak";
export const CONTROLLER_EMAIL = "g.ratajczak97@gmail.com";

/** Bump when the policy text changes materially. ISO date. */
export const PRIVACY_POLICY_UPDATED = "2026-10-18";
