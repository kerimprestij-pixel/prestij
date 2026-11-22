// The four storefront menus: one save for all of them, each menu locked by its own updatedAt. Only
// menus whose items changed are written (and audited). No Next APIs (DB-testable).
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { MenuItem } from "@/db/schema/site";
import type { MenuKey } from "@/lib/data/site";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import { MENU_KEY_LIST, menuDef } from "./menus";
import type { MenusSaveInput } from "./schemas";
import { stableJson } from "./sections";

const m = schema.menus;

type InputLink = { label: MenuItem["label"]; href: string; highlight?: boolean; children?: InputLink[] };

/** Stored shape: highlight only when true, children only when present (matches the seed data). */
function toStored(item: InputLink): MenuItem {
  const out: MenuItem = { label: item.label, href: item.href };
  if (item.highlight) out.highlight = true;
  if (item.children && item.children.length > 0) out.children = item.children.map((child) => toStored(child));
  return out;
}

export type SaveMenusResult = { updatedAt: Record<MenuKey, string | null>; changed: MenuKey[] };

export async function saveMenus(tx: Tx, input: MenusSaveInput): Promise<{ result: SaveMenusResult; audit: AuditEntry[] }> {
  const updatedAt = {} as Record<MenuKey, string | null>;
  const changed: MenuKey[] = [];
  const audit: AuditEntry[] = [];

  for (const key of MENU_KEY_LIST) {
    const menu = input.menus[key];
    const items = (menu.items as InputLink[]).map((item) => toStored(item));
    const [row] = await tx.select().from(m).where(eq(m.key, key)).for("update");

    if (!row) {
      if (menu.updatedAt !== null) throw new PanelError("conflict", "Bu menü siz düzenlerken silindi. Sayfayı yenileyin.");
      if (items.length === 0) {
        updatedAt[key] = null;
        continue;
      }
      const [created] = await tx.insert(m).values({ key, items }).returning({ updatedAt: m.updatedAt });
      updatedAt[key] = created.updatedAt.toISOString();
      changed.push(key);
      audit.push({ action: "create", entity: "menu", entityId: key, after: { name: menuDef(key)?.label ?? key, items } });
      continue;
    }

    assertFresh(row.updatedAt, menu.updatedAt);
    if (stableJson(row.items) === stableJson(items)) {
      updatedAt[key] = row.updatedAt.toISOString();
      continue;
    }
    const [saved] = await tx.update(m).set({ items, updatedAt: new Date() }).where(eq(m.id, row.id)).returning({ updatedAt: m.updatedAt });
    updatedAt[key] = saved.updatedAt.toISOString();
    changed.push(key);
    // The menu's Turkish name in both snapshots: the audit log shows "Üst menü", not the raw key.
    const name = menuDef(key)?.label ?? key;
    audit.push({ action: "update", entity: "menu", entityId: key, before: { name, items: row.items }, after: { name, items } });
  }

  return { result: { updatedAt, changed }, audit };
}
