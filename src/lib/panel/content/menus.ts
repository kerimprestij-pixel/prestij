// The four storefront menus as the panel presents them. Pure and client-safe.
import type { MenuKey } from "@/lib/data/site";

export type MenuDef = {
  key: MenuKey;
  label: string;
  description: string;
  /** Header items may have one level of children (a dropdown). */
  allowChildren: boolean;
  maxItems: number;
  /** What the storefront shows when the menu is empty. */
  emptyNote: string;
};

export const MAX_MENU_CHILDREN = 10;

export const MENU_DEFS: readonly MenuDef[] = [
  {
    key: "header",
    label: "Üst menü",
    description: "Sitenin üstündeki ana gezinme. Bir bağlantıya alt bağlantılar eklerseniz açılır menü olur.",
    allowChildren: true,
    maxItems: 8,
    emptyNote: "Boş bırakılırsa sitede varsayılan bağlantılar gösterilir.",
  },
  {
    key: "footer_shop",
    label: "Alt bilgi · Alışveriş",
    description: "Alt bilgideki alışveriş sütunu. “Sipariş sorgula” bağlantısı bu sütunun sonuna otomatik eklenir.",
    allowChildren: false,
    maxItems: 12,
    emptyNote: "Boş bırakılırsa sitede varsayılan bağlantılar gösterilir.",
  },
  {
    key: "footer_corporate",
    label: "Alt bilgi · Kurumsal",
    description: "Alt bilgideki kurumsal sütun: işletmeler, numune ve iletişim bağlantıları.",
    allowChildren: false,
    maxItems: 12,
    emptyNote: "Boş bırakılırsa sitede varsayılan bağlantılar gösterilir.",
  },
  {
    key: "footer_legal",
    label: "Alt bilgi · Yasal",
    description: "Alt bilgideki yasal metin bağlantıları (KVKK, mesafeli satış, çerezler…).",
    allowChildren: false,
    maxItems: 12,
    emptyNote: "Boş bırakılırsa bu sütun sitede gösterilmez.",
  },
];

export const MENU_KEY_LIST = MENU_DEFS.map((d) => d.key) as readonly MenuKey[];

export function menuDef(key: string): MenuDef | undefined {
  return MENU_DEFS.find((d) => d.key === key);
}
