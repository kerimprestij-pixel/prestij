"use client";
// "Yeni sayfa": title + address in a dialog; creates an unpublished custom page and opens its editor.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Field, LocalizedInput, SlugInput, usePanelForm } from "@/components/panel/form";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { createPageAction } from "@/app/panel/(dashboard)/sayfalar/actions";
import type { LocalizedText } from "@/db/schema/common";
import { pageCreateSchema } from "@/lib/panel/content/schemas";

type NewPageState = { title: LocalizedText; slug: string };
const EMPTY: NewPageState = { title: { tr: "" }, slug: "" };

export default function NewPageButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={FilePlus2} onClick={() => setOpen(true)} className={className}>
        Yeni sayfa
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Yeni sayfa"
        description="Sayfa taslak olarak oluşturulur; bölümlerini ekleyip hazır olduğunda yayınlarsınız."
      >
        {open ? <NewPageForm onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function NewPageForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const form = usePanelForm<NewPageState>(EMPTY);
  const { state, setField, formRef } = form;

  const submit = async () => {
    const result = await form.submit(createPageAction, { validate: pageCreateSchema });
    if (result.ok && result.data) {
      onDone();
      router.push(`/panel/sayfalar/${result.data.id}`);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <LocalizedInput
        label="Sayfa başlığı"
        required
        value={state.title}
        onChange={(v) => setField("title", v)}
        error={form.localizedError("title")}
        name="title"
        maxLength={120}
        placeholder="ör. Hakkımızda"
      />
      <Field label="Kısa ad (adres)" required error={form.errorFor("slug")} name="slug" help="Başlıktan otomatik oluşturulur; isterseniz değiştirebilirsiniz.">
        <SlugInput value={state.slug} onChange={(v) => setField("slug", v)} source={state.title.tr} prefix="/sayfa/" />
      </Field>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onDone} disabled={form.pending}>
          Vazgeç
        </Button>
        <Button type="submit" variant="primary" icon={FilePlus2} pending={form.pending} pendingLabel="Oluşturuluyor…">
          Oluştur ve düzenle
        </Button>
      </div>
    </form>
  );
}
