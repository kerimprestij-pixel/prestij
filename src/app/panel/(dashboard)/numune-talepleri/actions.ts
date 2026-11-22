"use server";
// Numune Talepleri actions (staff+). No cache tags (requests are never cached on the storefront):
// panelAction refreshes the open page. Schemas and run functions: src/lib/requests/definitions.ts.
import { panelAction } from "@/lib/panel/action";
import {
  noteSchema,
  runSaveSampleNote,
  runSetSampleStatus,
  runShipSample,
  sampleStatusSchema,
  shipSampleSchema,
} from "@/lib/requests/definitions";

export const setSampleStatusAction = panelAction({ minRole: "staff", schema: sampleStatusSchema, run: runSetSampleStatus });

export const shipSampleAction = panelAction({ minRole: "staff", schema: shipSampleSchema, run: runShipSample });

export const saveSampleNoteAction = panelAction({ minRole: "staff", schema: noteSchema, run: runSaveSampleNote });
