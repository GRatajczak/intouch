import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function DeleteDataSection() {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleDelete() {
    setDeleteBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/settings/delete-data", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Nie udało się usunąć danych");
      }
      window.location.href = "/?notice=" + encodeURIComponent("Twoje dane zostały usunięte");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się usunąć danych");
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <p className="text-muted-foreground mb-4 text-sm">
        Trwale usuniesz wszystkie dodane osoby, historię kontaktu i swój profil. Twoje konto pozostanie aktywne —
        będziesz mógł zalogować się ponownie, ale zaczniesz od zera.
      </p>
      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive">
            <Trash2 className="size-4" />
            Usuń wszystkie dane
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć wszystkie Twoje dane?</AlertDialogTitle>
            <AlertDialogDescription>
              Nie można cofnąć tej operacji. Wszystkie osoby, ich historia kontaktu, obliczone rankingi i Twój profil
              zostaną usunięte bezpowrotnie. Zostaniesz wylogowany, a Twoje konto pozostanie puste — będziesz mógł
              zalogować się ponownie i zacząć od nowa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Anuluj</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction -- Action closes the
                dialog on click unconditionally (Radix ignores
                preventDefault there), which would dismiss the
                confirmation even when the delete request fails. */}
            <Button
              type="button"
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => {
                void handleDelete();
              }}
            >
              Usuń wszystkie dane
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
