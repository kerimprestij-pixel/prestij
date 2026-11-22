"use server";
// Kurumsal Hesaplar + Müşteri Grupları (admin: business approvals, customer groups and payment terms).
// Staff may open the pages read-only; every mutation here requires the admin role (contract role table).
// Schemas: src/lib/b2b/panel-schemas.ts; run functions: src/lib/b2b/panel-definitions.ts (DB-tested).
import { panelAction } from "@/lib/panel/action";
import {
  runApproveCompany,
  runCreateGroup,
  runDeleteGroup,
  runRejectCompany,
  runUpdateCompany,
  runUpdateCompanyTerms,
  runUpdateGroup,
} from "@/lib/b2b/panel-definitions";
import {
  companyTermsSchema,
  createGroupSchema,
  deleteGroupSchema,
  rejectCompanySchema,
  updateCompanySchema,
  updateGroupSchema,
} from "@/lib/b2b/panel-schemas";

export const approveCompanyAction = panelAction({ minRole: "admin", schema: companyTermsSchema, run: runApproveCompany });

export const updateCompanyTermsAction = panelAction({ minRole: "admin", schema: companyTermsSchema, run: runUpdateCompanyTerms });

export const rejectCompanyAction = panelAction({ minRole: "admin", schema: rejectCompanySchema, run: runRejectCompany });

export const updateCompanyAction = panelAction({ minRole: "admin", schema: updateCompanySchema, run: runUpdateCompany });

export const createGroupAction = panelAction({ minRole: "admin", schema: createGroupSchema, run: runCreateGroup });

export const updateGroupAction = panelAction({ minRole: "admin", schema: updateGroupSchema, run: runUpdateGroup });

export const deleteGroupAction = panelAction({ minRole: "admin", schema: deleteGroupSchema, run: runDeleteGroup });
