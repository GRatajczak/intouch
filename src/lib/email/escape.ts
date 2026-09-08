/**
 * HTML-escapes a value destined for an email template.
 *
 * Both email builders in this repo assemble strings by concatenation, so
 * nothing escapes for them. Every value they interpolate is authored by the
 * user (person names, descriptions) or by the model (`reason`), and an
 * unescaped apostrophe is enough to break the layout. Shared between the shell
 * and the reminder body so the two cannot drift into escaping differently.
 *
 * Note what is deliberately NOT run through this: `bodyHtml` and `footerNote`
 * are markup the caller built on purpose. Escaping those would render the
 * template as source code.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
