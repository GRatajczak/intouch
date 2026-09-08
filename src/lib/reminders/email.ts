import { escapeHtml } from "@/lib/email/escape";
import { renderEmailShell } from "@/lib/email/shell";
import type { RankingEntryViewModel } from "@/lib/ranking/store";
import type { ReasonFactor } from "@/lib/reminders/select";
import { TIME_WINDOW_LABELS, type TimeWindow } from "@/lib/validation/ranking";

export interface RenderReminderEmailParams {
  hero: RankingEntryViewModel;
  queue: RankingEntryViewModel[];
  factors: ReasonFactor[];
  /** From `profiles.name`; the headline drops the address when this is empty. */
  profileName: string | null;
  /** The app's canonical origin, read once by the caller. Never hardcoded here. */
  baseUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

// Palette lifted from InTouch.dc.html:1078-1155. Inline hex rather than the
// app's CSS tokens because mail clients strip <style> and resolve no custom
// properties -- an email is the one surface in this repo that cannot use the
// design system, only mirror it.
const INK = "#2A2724";
const BODY_TEXT = "#55504A";
const MUTED = "#8B837A";
const CARD_BORDER = "#EAE3D9";
const BUTTON_BORDER = "#E4DCD1";
const PILL_BG = "#F7D9DC";
const PILL_TEXT = "#8C4A52";

/** Dot colour per factor kind, matching the mock's four bullets. */
const FACTOR_DOT: Record<ReasonFactor["kind"], string> = {
  weight: "#C48A93",
  silence: "#C48A93",
  failed_attempt: "#C9A96A",
  rhythm: "#8E96C4",
};

/** Queue time-window colours, warmest for the nearest window. */
const QUEUE_WINDOW_COLOR: Record<TimeWindow, string> = {
  this_week: "#8C4A52",
  two_weeks: "#8A6A34",
  this_month: "#4A6B52",
  no_rush: "#6B645C",
};

const FOOTER_NOTE = "Wysyłamy maksymalnie jedną taką wiadomość dziennie, tylko o relacjach, które cichną.";

/**
 * A link styled as a button.
 *
 * lessons.md records `<Button asChild>` silently rendering unstyled links in
 * `.astro`; email HTML has the same trap with a different cause -- clients drop
 * <style> blocks, so a class-based button is a bare link in half the inboxes
 * that receive it. Styles therefore live on the anchor itself, and the human
 * look at the preview is what actually confirms it.
 */
function buttonLink(href: string, label: string, variant: "primary" | "secondary"): string {
  const style =
    variant === "primary"
      ? `display: block; padding: 16px 20px; border-radius: 14px; background: ${INK}; color: #FBF8F4; font-size: 16px; font-weight: 600; text-align: center; text-decoration: none;`
      : `display: block; padding: 13px 16px; border-radius: 14px; background: #FFFFFF; border: 1px solid ${BUTTON_BORDER}; color: ${BODY_TEXT}; font-size: 14px; font-weight: 600; text-align: center; text-decoration: none;`;

  return `<a href="${href}" style="${style}">${label}</a>`;
}

function renderFactors(factors: ReasonFactor[]): string {
  if (factors.length === 0) {
    return "";
  }

  const rows = factors
    .map(
      (factor) =>
        `<tr><td style="padding: 5px 0;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${FACTOR_DOT[factor.kind]};"></span>` +
        `<span style="padding-left: 12px; font-size: 15px; color: ${INK};">${escapeHtml(factor.text)}</span></td></tr>`,
    )
    .join("");

  return (
    `<div style="margin-top: 24px; background: #FFFFFF; border: 1px solid ${CARD_BORDER}; border-radius: 18px; padding: 22px;">` +
    `<div style="font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED};">Dlaczego akurat teraz</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 10px; width: 100%;">${rows}</table>` +
    `</div>`
  );
}

/** The mock's "W kolejce, ale bez pośpiechu". Omitted entirely when empty. */
function renderQueue(queue: RankingEntryViewModel[]): string {
  if (queue.length === 0) {
    return "";
  }

  const rows = queue
    .map(
      (item) =>
        `<tr>` +
        `<td style="padding: 6px 0; font-size: 14px; font-weight: 600; color: ${INK};">${escapeHtml(item.person.name)}</td>` +
        `<td style="padding: 6px 0; font-size: 14px; text-align: right; color: ${QUEUE_WINDOW_COLOR[item.timeWindow]};">${escapeHtml(TIME_WINDOW_LABELS[item.timeWindow])}</td>` +
        `</tr>`,
    )
    .join("");

  return (
    `<div style="margin-top: 26px; border-top: 1px solid ${CARD_BORDER}; padding-top: 20px;">` +
    `<div style="font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED};">W kolejce, ale bez pośpiechu</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 10px; width: 100%;">${rows}</table>` +
    `</div>`
  );
}

/**
 * The headline addresses the reader by name in the nominative.
 *
 * The mock says "Cześć Anno" -- the vocative. Polish vocative cannot be derived
 * from a stored nominative without a morphology library, and "Cześć Anna" is a
 * grating half-measure, so the name is placed where the nominative is correct
 * instead. Divergence from the design is deliberate and recorded here.
 */
function headline(profileName: string | null, heroName: string): string {
  const subject = `${heroName} czeka najdłużej`;
  const name = profileName?.trim();
  return name ? `${name}, ${subject}` : subject.charAt(0).toUpperCase() + subject.slice(1);
}

export function renderReminderEmail(params: RenderReminderEmailParams): RenderedEmail {
  const { hero, queue, factors, profileName, baseUrl } = params;
  const heroName = hero.person.name;

  // Collapsed to one line, not html-escaped: this is a MIME header, so markup
  // means nothing here but a line break ends the field and turns whatever
  // follows into a header of its own.
  const subject = `${heroName} — czas się odezwać`.replace(/[\r\n]+/g, " ").trim();

  const bodyHtml =
    `<div style="background: ${PILL_BG}; color: ${PILL_TEXT}; font-size: 12px; font-weight: 700; padding: 7px 13px; border-radius: 999px; display: inline-block;">${escapeHtml(TIME_WINDOW_LABELS[hero.timeWindow])}</div>` +
    `<h1 style="margin: 14px 0 0; font-family: 'Instrument Serif', Georgia, serif; font-size: 32px; line-height: 1.15; font-weight: 400; color: ${INK};">${escapeHtml(headline(profileName, heroName))}</h1>` +
    `<p style="margin: 14px 0 0; font-size: 16px; line-height: 1.65; color: ${BODY_TEXT};">${escapeHtml(hero.reason)}</p>` +
    renderFactors(factors) +
    `<div style="margin-top: 26px;">${buttonLink(`${baseUrl}/people/${hero.person.id}`, "Zaplanuję kontakt", "primary")}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 10px; width: 100%;"><tr>` +
    `<td style="width: 50%; padding-right: 5px;">${buttonLink(`${baseUrl}/dashboard`, "Odłóż o tydzień", "secondary")}</td>` +
    `<td style="width: 50%; padding-left: 5px;">${buttonLink(`${baseUrl}/dashboard`, "Już rozmawialiśmy", "secondary")}</td>` +
    `</tr></table>` +
    renderQueue(queue);

  // The mock's footer promises "Zmień częstotliwość · Wypisz się". There is no
  // frequency control to link to -- cadence stays product-owned -- so the
  // promise is narrowed to the one that exists.
  const footerNote = `${FOOTER_NOTE} <a href="${baseUrl}/settings" style="color: ${MUTED};">Ustawienia przypomnień</a>`;

  return { subject, html: renderEmailShell({ subject, bodyHtml, footerNote }) };
}
