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

export default function DeleteAccountSection() {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleDelete() {
    setDeleteBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/settings/delete-account", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Nie udało się usunąć konta");
      }
      window.location.href = "/?notice=" + encodeURIComponent("Twoje konto zostało usunięte");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się usunąć konta");
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <p className="text-muted-foreground mb-4 text-sm">
        Trwale usuniesz swoje konto razem ze wszystkimi danymi: dodanymi osobami, historią kontaktu, rankingami,
        profilem i adresem e-mail. Nie będzie można tego cofnąć.
      </p>
      {error && <p className="text-destructive mb-4 text-sm">{error}</p>}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive">
            <Trash2 className="size-4" />
            Usuń konto
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć konto?</AlertDialogTitle>
            <AlertDialogDescription>
              Nie można cofnąć tej operacji. Twoje konto, wszystkie osoby, ich historia kontaktu, obliczone rankingi,
              profil i adres e-mail zostaną usunięte bezpowrotnie. Zostaniesz wylogowany.
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
              Usuń konto
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
