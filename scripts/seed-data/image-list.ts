// Reads kaynak/.../Gorsel_Listesi.csv (the client's image inventory). Treated as data only.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const SOURCE_ROOT = path.join(process.cwd(), "kaynak", "PRESTIJ_Katalog_ve_Gorseller_v1");
export const LOGO_SOURCE = path.join(SOURCE_ROOT, "03_Sanal_Katalog", "assets", "prestij-logo.png");

export type Urun = "lavanta_latte" | "lavanta" | "portakal" | "okyanus" | "collection";
export type Ambalaj = "pump" | "5l" | "20l" | "20l_graphic";

export type ImageRow = {
  /** Path relative to SOURCE_ROOT (forward slashes). */
  file: string;
  /** File name without extension; the media's stable identity ("@media:<stem>"). */
  stem: string;
  urun: Urun;
  ambalaj: Ambalaj;
  /** Turkish scene description, used as alt text. */
  scene: string;
  width: number;
  height: number;
};

const URUNLER: readonly Urun[] = ["lavanta_latte", "lavanta", "portakal", "okyanus", "collection"];
const AMBALAJLAR: readonly Ambalaj[] = ["pump", "5l", "20l", "20l_graphic"];

/** Minimal RFC 4180 parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip UTF-8 BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** Final-concept images only (drafts in 99_Taslak_Revizyonlar are skipped). */
export async function readImageList(): Promise<ImageRow[]> {
  const [header, ...lines] = parseCsv(await readFile(path.join(SOURCE_ROOT, "Gorsel_Listesi.csv"), "utf8"));
  const col = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Gorsel_Listesi.csv: missing column "${name}"`);
    return index;
  };
  const c = { file: col("Dosya"), urun: col("Urun"), ambalaj: col("Ambalaj"), scene: col("Sahne"), w: col("Genislik"), h: col("Yukseklik") };

  return lines
    .filter((l) => !l[c.file].startsWith("99_Taslak_Revizyonlar/"))
    .map((l) => {
      const urun = l[c.urun] as Urun;
      const ambalaj = l[c.ambalaj] as Ambalaj;
      if (!URUNLER.includes(urun) || !AMBALAJLAR.includes(ambalaj)) {
        throw new Error(`Gorsel_Listesi.csv: unexpected Urun/Ambalaj "${urun}/${ambalaj}" for ${l[c.file]}`);
      }
      const file = l[c.file].replace(/\\/g, "/");
      return {
        file,
        stem: path.basename(file).replace(/\.[^.]+$/, ""),
        urun,
        ambalaj,
        scene: l[c.scene].trim(),
        width: Number(l[c.w]),
        height: Number(l[c.h]),
      };
    });
}
