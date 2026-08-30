import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <UsersRound className="text-text-tertiary size-10" />
      <h2 className="text-foreground text-lg font-semibold">Nie masz jeszcze nikogo na liście</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        Dodaj pierwszą osobę lub grupę, o kontakt z którą chcesz dbać.
      </p>
      <Button asChild>
        <a href="/people/new">Dodaj pierwszą osobę</a>
      </Button>
    </div>
  );
}
