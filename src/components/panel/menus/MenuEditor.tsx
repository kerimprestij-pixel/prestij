"use client";
// The four storefront menus in one form (one save, each menu locked by its own updatedAt): localized
// label, link picker and highlight per item, one level of children in the header, drag reorder, and a
// small live preview of how the menu reads on the site.
import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Field, LinkInput, LocalizedInput, Repeater, SaveBar, Switch, usePanelForm, type PanelForm } from "@/components/panel/form";
import Tabs from "@/components/panel/ui/Tabs";
import { saveMenusAction } from "@/app/panel/(dashboard)/menuler/actions";
import type { MenuItem } from "@/db/schema/site";
import type { MenuKey } from "@/lib/data/site";
import { MAX_MENU_CHILDREN, MENU_DEFS, type MenuDef } from "@/lib/panel/content/menus";
import { menusSaveSchema } from "@/lib/panel/content/schemas";
import type { MenusEditorState } from "@/lib/panel/content/types";
import { cn } from "@/lib/utils";

type Form = PanelForm<MenusEditorState>;

const newItem = (): MenuItem => ({ label: { tr: "" }, href: "" });

export default function MenuEditor({ initial }: { initial: MenusEditorState }) {
  const form = usePanelForm(initial);
  const { formRef } = form;
  const [tab, setTab] = useState<MenuKey>("header");

  const save = () =>
    form.submit(saveMenusAction, {
      validate: menusSaveSchema,
      resetTo: (sent, data) => {
        if (!data) return sent;
        const menus = { ...sent.menus };
        for (const def of MENU_DEFS) menus[def.key] = { ...menus[def.key], updatedAt: data.updatedAt[def.key] };
        return { menus };
      },
      onError: (result) => {
        const first = Object.keys(result.fieldErrors ?? {})[0];
        const key = first?.split(".")[1] as MenuKey | undefined;
        if (key && MENU_DEFS.some((d) => d.key === key)) setTab(key);
      },
    });

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} noValidate className="space-y-6 pb-28">
      <Tabs
        ariaLabel="Menüler"
        value={tab}
        onValueChange={(v) => setTab(v as MenuKey)}
        items={MENU_DEFS.map((def) => ({
          value: def.key,
          label: def.label,
          badge: <span className="tabular-nums">{form.state.menus[def.key].items.length}</span>,
          invalid: form.hasErrors(`menus.${def.key}`),
          content: <MenuPanel def={def} form={form} />,
        }))}
      />
      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={save}
        saveLabel="Menüleri kaydet"
      />
    </form>
  );
}

function MenuPanel({ def, form }: { def: MenuDef; form: Form }) {
  const base = `menus.${def.key}.items`;
  const items = form.state.menus[def.key].items;
  const listError = form.errorsUnder(base)[""];

  return (
    <div className="grid gap-6 pt-5 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
      <div className="min-w-0 space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-xs leading-relaxed text-text-muted">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-gold-text" />
          <p>
            {def.description} {def.emptyNote}
          </p>
        </div>
        <Repeater
          items={items}
          onChange={(next) => form.setField(base, next)}
          createItem={newItem}
          noun="Bağlantı"
          ariaLabel={`${def.label} bağlantıları`}
          max={def.maxItems}
          itemSummary={(item) => item.label.tr}
          itemHasError={(index) => form.hasErrors(`${base}.${index}`)}
          emptyText={`Bu menüde bağlantı yok. ${def.emptyNote}`}
          renderItem={(item, { index }) => (
            <MenuItemFields
              item={item}
              path={`${base}.${index}`}
              form={form}
              allowChildren={def.allowChildren}
            />
          )}
        />
        {listError ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{listError}</p> : null}
      </div>
      <MenuPreview def={def} items={items} />
    </div>
  );
}

function MenuItemFields({ item, path, form, allowChildren, child = false }: { item: MenuItem; path: string; form: Form; allowChildren: boolean; child?: boolean }) {
  const children = item.children ?? [];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <LocalizedInput
          label="Bağlantı yazısı"
          required
          value={item.label}
          onChange={(v) => form.setField(`${path}.label`, v)}
          error={form.localizedError(`${path}.label`)}
          name={`${path}.label`}
          maxLength={60}
        />
        <Field label="Bağlantı" required error={form.errorFor(`${path}.href`)} name={`${path}.href`}>
          <LinkInput value={item.href} onChange={(href) => form.setField(`${path}.href`, href)} />
        </Field>
      </div>
      <Switch
        checked={Boolean(item.highlight)}
        onChange={(on) => form.setField(`${path}.highlight`, on || undefined)}
        label="Altın renkle vurgula"
        description={child ? "Açılır menüde bu bağlantıyı öne çıkarır." : "Kampanya gibi öne çıkarmak istediğiniz bağlantılar için."}
        size="sm"
      />
      {allowChildren ? (
        <fieldset className="min-w-0 space-y-2 rounded-xl border border-border bg-surface-2/30 p-3 sm:p-4" data-field={`${path}.children`}>
          <legend className="sr-only">Alt bağlantılar</legend>
          <p className="text-sm font-medium text-text" aria-hidden>
            Alt bağlantılar
          </p>
          <p className="text-xs text-text-muted">İsteğe bağlı. Eklerseniz bu bağlantı sitede açılır menü olur.</p>
          <Repeater
            items={children}
            onChange={(next) => form.setField(`${path}.children`, next.length > 0 ? next : undefined)}
            createItem={newItem}
            noun="Alt bağlantı"
            ariaLabel={`${item.label.tr || "Bağlantı"}: alt bağlantılar`}
            max={MAX_MENU_CHILDREN}
            itemSummary={(c) => c.label.tr}
            defaultCollapsed
            itemHasError={(index) => form.hasErrors(`${path}.children.${index}`)}
            emptyText="Alt bağlantı yok."
            renderItem={(c, { index }) => <MenuItemFields item={c} path={`${path}.children.${index}`} form={form} allowChildren={false} child />}
          />
        </fieldset>
      ) : null}
    </div>
  );
}

/** How the menu reads on the site (Turkish labels; highlighted items in gold, dropdowns marked). */
function MenuPreview({ def, items }: { def: MenuDef; items: MenuItem[] }) {
  const header = def.key === "header";
  return (
    <aside aria-label="Önizleme" className="rounded-xl border border-border bg-surface p-4 xl:sticky xl:top-20">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-text-muted">Önizleme</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{def.emptyNote}</p>
      ) : header ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {items.map((item, i) => (
            <li key={i} className={cn("inline-flex items-center gap-1 text-sm", item.highlight ? "text-gold-text" : "text-text")}>
              {item.label.tr || <span className="italic text-text-muted">Adsız</span>}
              {item.children?.length ? <ChevronDown aria-label={`${item.children.length} alt bağlantı`} className="size-3.5 text-text-muted" /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className={cn("text-sm", item.highlight ? "text-gold-text" : "text-text-muted")}>
              {item.label.tr || <span className="italic">Adsız</span>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
