// CSV for spreadsheet apps (Excel with Turkish regional settings first). Pure.
//
// - UTF-8 with a BOM, so Excel shows ç ğ ı İ ö ş ü correctly (without it, Excel reads Windows-1254).
// - Semicolon separator: Turkish Excel uses ";" as the list separator (the comma is the decimal mark),
//   so a double-clicked file opens in columns. A "sep=;" line is NOT used: Excel then ignores the BOM.
// - CRLF line ends; fields with ; " CR or LF are quoted, quotes doubled (RFC 4180).
// - Formula injection: a cell starting with = + - @ tab or CR gets a leading apostrophe.

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

const NEEDS_QUOTES = /[";\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file: BOM + header row + rows, CRLF separated, ending with CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(CSV_SEPARATOR));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
