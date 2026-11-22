"use client";
// Delete a category. With products in it, the dialog asks where they go first (another category or
// "Kategorisiz"); the move and the delete run in one transaction on the server.
import { useState } from "react";
import { deleteCategoryAction } from "@/app/panel/(dashboard)/kategoriler/actions";
import Field from "@/components/panel/form/Field";
import Select from "@/components/panel/form/Select";
import ConfirmDialog from "@/components/panel/ui/ConfirmDialog";
import { toast } from "@/components/panel/ui/toast-store";
import { toPayloadFormData } from "@/lib/panel/action-types";

type Props = {
  category: { id: number; name: string; productCount: number; updatedAt: string };
  others: { id: number; name: string }[];
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
};

export default function DeleteCategoryDialog({ category, others, open, onClose, onDeleted }: Props) {
  const [target, setTarget] = useState<string>(others[0] ? String(others[0].id) : "none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inUse = category.productCount > 0;

  async function remove() {
    setPending(true);
    setError(null);
    const base = { id: category.id, updatedAt: category.updatedAt };
    const payload = inUse ? { ...base, moveProductsTo: target === "none" ? "none" : Number(target) } : base;
    const result = await deleteCategoryAction(null, toPayloadFormData(payload));
    setPending(false);
    if (result.ok) {
      toast.success(result.message ?? "Kategori silindi.");
      onDeleted();
      return;
    }
    setError(result.fieldErrors?.moveProductsTo ?? result.error);
    toast.error(result.error);
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={remove}
      pending={pending}
      title={`“${category.name}” silinsin mi?`}
      description={
        inUse
          ? `Bu kategoride ${category.productCount} ürün var. Silmeden önce ürünlerin taşınacağı yeri seçin. Bu işlem geri alınamaz.`
          : "Kategori kalıcı olarak silinir; eski bağlantısı artık açılmaz. Bu işlem geri alınamaz."
      }
      confirmLabel={inUse ? "Ürünleri taşı ve sil" : "Sil"}
    >
      {inUse ? (
        <Field label="Ürünleri şuraya taşı" error={error} name="moveProductsTo">
          <Select<string>
            value={target}
            onChange={setTarget}
            options={[...others.map((c) => ({ value: String(c.id), label: c.name })), { value: "none", label: "Kategorisiz bırak" }]}
          />
        </Field>
      ) : error ? (
        <p className="text-sm font-medium text-[#B3261E] dark:text-[#F28B82]">{error}</p>
      ) : null}
    </ConfirmDialog>
  );
}
