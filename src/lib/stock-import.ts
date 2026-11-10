// Turns a CSV file into stock rows. Columns are matched by header name, so the Stock
// export (Tag, Model, Serial number, Specifications, Notes, ...) imports as it is.

import { parseCsv } from "./csv.ts";

export type StockCsvRow = {
  tag: string;
  model: string;
  serialNumber: string;
  specifications: string;
  notes: string;
};

const HEADERS: Record<keyof StockCsvRow, string[]> = {
  tag: ["tag"],
  model: ["model"],
  serialNumber: ["serial number", "serial", "serialnumber"],
  specifications: ["specifications", "specification", "specs"],
  notes: ["notes", "note"],
};

export const STOCK_CSV_TEMPLATE =
  "Tag,Model,Serial number,Specifications,Notes\r\nDP-LT-0001,Dell Latitude 5440,SN12345,16GB / 512GB,Shelf B2\r\n";

/** Reads the header row and maps the data rows; an error message for an unusable file. */
export function parseStockCsv(text: string): { rows: StockCsvRow[] } | { error: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { error: "The file is empty." };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index = {} as Record<keyof StockCsvRow, number>;
  for (const key of Object.keys(HEADERS) as (keyof StockCsvRow)[])
    index[key] = header.findIndex((h) => HEADERS[key].includes(h));
  if (index.tag === -1 || index.model === -1)
    return { error: "The first row must be a header with at least Tag and Model columns." };
  const at = (r: string[], key: keyof StockCsvRow) =>
    index[key] === -1 ? "" : (r[index[key]] ?? "").trim();
  return {
    rows: table.slice(1).map((r) => ({
      tag: at(r, "tag"),
      model: at(r, "model"),
      serialNumber: at(r, "serialNumber"),
      specifications: at(r, "specifications"),
      notes: at(r, "notes"),
    })),
  };
}
