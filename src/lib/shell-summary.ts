import type { AstroCookies } from "astro";
import { createClient } from "@/lib/supabase";

/**
 * Data for `AppSidebar`'s profile-summary footer.
 *
 * Kept here rather than inside the layout component so shell pages own their
 * queries the same way every other page in this codebase does — Astro has no
 * layout-level data loading, and hiding a Supabase call inside a "dumb" layout
 * would make the per-render subrequest count invisible at the call site.
 *
 * Returns `null` when no `profiles` row exists yet. That case is reachable:
 * `middleware.ts` gates only `/people` on profile existence, so a signed-up
 * user who skipped `/profile` reaches `/dashboard` and `/settings` without
 * one. `AppSidebar` renders an "Uzupełnij profil" prompt for it.
 */
export async function loadProfileName(
  requestHeaders: Headers,
  cookies: AstroCookies,
  ownerId: string | undefined,
): Promise<string | null> {
  if (!ownerId) return null;

  const supabase = createClient(requestHeaders, cookies);
  if (!supabase) return null;

  const { data } = await supabase.from("profiles").select("name").eq("owner_id", ownerId).maybeSingle();
  return data?.name ?? null;
}
