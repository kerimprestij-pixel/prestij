"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createThemeAction } from "@/app/panel/(dashboard)/tema/actions";
import Field from "@/components/panel/form/Field";
import TextInput from "@/components/panel/form/TextInput";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";

export type CreateThemeSource = { id: number; name: string } | null;

type CreateThemeDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Theme to copy; null = a copy of the default theme. */
  source: CreateThemeSource;
};

/** Name dialog for "Yeni tema" / "Kopyasını oluştur"; opens the new theme's editor on success. */
export default function CreateThemeDialog({ open, onClose, source }: CreateThemeDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={source ? "Temanın kopyasını oluştur" : "Yeni tema"}
      description={
        source
          ? `“${source.name}” temasının renkleri, yazı tipleri ve zamanlaması kopyalanır.`
          : "Yeni tema, varsayılan temanın renkleri ve yazı tipleriyle başlar. Oluşturduktan sonra düzenleyebilirsiniz."
      }
      size="sm"
    >
      {/* Mounted only while open (Dialog), so the form state starts fresh each time. */}
      <CreateThemeForm source={source} onClose={onClose} />
    </Dialog>
  );
}

function CreateThemeForm({ source, onClose }: { source: CreateThemeSource; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(source ? `${source.name} (kopya)` : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function create() {
    if (pending) return;
    if (!name.trim()) {
      setError("Tema adı gerekli.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const result = await createThemeAction(null, toPayloadFormData({ name, fromId: source?.id ?? null }));
      if (result.ok && result.data) {
        toast.success(result.message ?? "Tema oluşturuldu.");
        onClose();
        router.push(`/panel/tema/${result.data.id}`);
        return;
      }
      if (!result.ok) {
        setError(result.fieldErrors?.name ?? null);
        if (!result.fieldErrors?.name) toast.error(result.error);
        inputRef.current?.focus();
      }
    } catch {
      toast.error("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
      className="space-y-5"
    >
      <Field label="Tema adı" required error={error} help="Örneğin “Anneler Günü” veya “Kış 2026”.">
        <TextInput
          ref={inputRef}
          value={name}
          onChange={(value) => {
            setName(value);
            setError(null);
          }}
          maxLength={60}
          autoFocus
          autoComplete="off"
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Vazgeç
        </Button>
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Oluşturuluyor…">
          Oluştur ve düzenle
        </Button>
      </div>
    </form>
  );
}
