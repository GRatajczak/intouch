import { UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HierarchyEmptyStateProps, HierarchyEmptyStateVariant } from "./types";

// Modelled on src/components/people/EmptyState/EmptyState.tsx: icon, heading,
// one line of explanation, one primary action pointing at the route that
// resolves this state, rather than a dead end.
const CONTENT: Record<
  HierarchyEmptyStateVariant,
  { icon: typeof UserRound; heading: string; body: string; actionLabel: string; actionHref: string }
> = {
  "no-profile": {
    icon: UserRound,
    heading: "Uzupełnij swój profil",
    body: "Potrzebujemy Twojego profilu, żeby ułożyć kolejność kontaktów.",
    actionLabel: "Uzupełnij profil",
    actionHref: "/profile",
  },
  "no-people": {
    icon: UsersRound,
    heading: "Nie masz jeszcze nikogo na liście",
    body: "Dodaj pierwszą osobę lub grupę, żebyśmy mogli ułożyć dla Ciebie kolejność kontaktów.",
    actionLabel: "Dodaj pierwszą osobę",
    actionHref: "/people/new",
  },
};

export function HierarchyEmptyState({ variant }: HierarchyEmptyStateProps) {
  const { icon: Icon, heading, body, actionLabel, actionHref } = CONTENT[variant];

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Icon className="text-text-tertiary size-10" />
      <h2 className="text-foreground text-lg font-semibold">{heading}</h2>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
      <Button asChild>
        <a href={actionHref}>{actionLabel}</a>
      </Button>
    </div>
  );
}
