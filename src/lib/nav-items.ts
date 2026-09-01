import { Sun, UsersRound, User, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for both nav renderings — `AppSidebar` (desktop) and
 * `BottomNav` (mobile). Icons are imported directly rather than looked up by
 * name so Astro can render them to static HTML server-side, with no hydration.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dziś", icon: Sun },
  { href: "/people", label: "Bliscy", icon: UsersRound },
  { href: "/profile", label: "Profil", icon: User },
  { href: "/settings", label: "Ustawienia", icon: Settings },
];

/**
 * Exact-or-prefix match, so `/people/new` would still light up "Bliscy". The
 * trailing-slash guard keeps `/peopleish` from matching `/people`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
