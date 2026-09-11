import React, { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
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
import { showToast } from "@/components/layout/Toaster";
import type { ApiKeySectionProps } from "./types";

async function unwrapError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

/**
 * S-17's BYOK section: paste a key, see the mask, remove it. Sits between
 * "Przypomnienia" and "Prywatność" on the same card grammar as the other
 * settings sections.
 *
 * Three renders, driven by `hint`/`unreadable` state: no key (input, plus the
 * free-tier line), a usable key (mask + remove), and an unreadable key (the
 * ciphertext exists but decryption failed -- OUR fault, not the owner's, so
 * this asks for it again rather than pretending nothing is stored).
 */
export default function ApiKeySection({
  hint: initialHint,
  unreadable: initialUnreadable,
  failure: initialFailure,
}: ApiKeySectionProps) {
  const [hint, setHint] = useState(initialHint);
  const [unreadable, setUnreadable] = useState(initialUnreadable);
  const [failure, setFailure] = useState(initialFailure);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  async function handleSave(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setFieldError(undefined);
    try {
      const response = await fetch("/api/settings/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      if (!response.ok) {
        throw new Error(await unwrapError(response, "Nie udało się zapisać klucza"));
      }

      const body: { hint: string | null } = await response.json();
      setHint(body.hint);
      setUnreadable(false);
      setFailure(null);
      setApiKey("");
      showToast("success", "Klucz OpenAI zapisany");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Nie udało się zapisać klucza";
      setFieldError(message);
      showToast("error", message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    if (isRemoving) {
      return;
    }

    setIsRemoving(true);
    try {
      const response = await fetch("/api/settings/openai-key", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await unwrapError(response, "Nie udało się usunąć klucza"));
      }

      setHint(null);
      setUnreadable(false);
      setRemoveDialogOpen(false);
      showToast("success", "Klucz OpenAI usunięty");
    } catch (err: unknown) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się usunąć klucza");
    } finally {
      setIsRemoving(false);
    }
  }

  if (hint !== null && !unreadable) {
    return (
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-foreground text-sm font-medium">Klucz OpenAI: sk-…{hint}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Rankingi liczone tym kluczem nie mają dziennego limitu ręcznych przeliczeń.
          </p>
          {failure === "auth" && (
            <p className="text-destructive mt-1 text-sm">
              OpenAI odrzucił ten klucz przy ostatnim przeliczeniu. Wklej go ponownie.
            </p>
          )}
          {failure === "quota" && (
            <p className="text-destructive mt-1 text-sm">
              Limit tego klucza został wyczerpany przy ostatnim przeliczeniu. Sprawdź swój plan w OpenAI.
            </p>
          )}
        </div>

        <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline">
              <Trash2 className="size-4" />
              Usuń klucz
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Usunąć zapisany klucz OpenAI?</AlertDialogTitle>
              <AlertDialogDescription>
                Wrócisz do darmowego limitu: jedno ręczne przeliczenie dziennie. Automatyczne odświeżanie co 24 godziny
                zostaje bez zmian.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRemoving}>Anuluj</AlertDialogCancel>
              {/* A plain Button, not AlertDialogAction -- Action closes the
                  dialog on click unconditionally (Radix ignores
                  preventDefault there), which would dismiss the
                  confirmation even when the delete request fails. */}
              <Button type="button" variant="destructive" disabled={isRemoving} onClick={() => void handleRemove()}>
                Usuń klucz
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSave(event)} className="space-y-4" noValidate>
      {unreadable && (
        <p className="text-destructive text-sm">Zapisanego klucza nie da się już odczytać. Wklej go ponownie.</p>
      )}

      <FormField
        id="openaiApiKey"
        label="Klucz OpenAI"
        type={showKey ? "text" : "password"}
        value={apiKey}
        onChange={(value) => {
          setApiKey(value);
          if (fieldError) {
            setFieldError(undefined);
          }
        }}
        placeholder="sk-…"
        error={fieldError}
        autoComplete="off"
        icon={<KeyRound className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showKey}
            onToggle={() => {
              setShowKey(!showKey);
            }}
          />
        }
        hint={
          <p className="text-muted-foreground mt-1 text-xs">
            Bez własnego klucza masz jedno ręczne przeliczenie dziennie. Automatyczne odświeżanie co 24 godziny zawsze
            jest bez limitu.
          </p>
        }
      />

      <Button type="submit" disabled={isSaving}>
        {isSaving ? "Zapisywanie…" : "Zapisz klucz"}
      </Button>
    </form>
  );
}
