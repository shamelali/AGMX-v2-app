/**
 * AGMX Validation Schemas
 * Centralized validation using Zod
 */

import { z } from "zod";

export const memberSchema = z.object({
  memberNo: z.string().min(1, "Member number required"),
  name: z.string().min(1, "Name required"),
  ic: z.string().regex(/^\d{12}$/, "IC must be 12 digits"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
});

export const documentSchema = z.object({
  title: z.string().min(1, "Title required"),
  category: z.enum(["agm_notice", "minutes", "resolution", "financial", "other"]),
  filename: z.string().min(1, "Filename required"),
  mime: z.string().min(1, "MIME type required"),
  sizeBytes: z.number().int().positive("Size must be positive"),
  agmId: z.string().optional(),
});

export const complianceResultSchema = z.object({
  agmId: z.string().min(1, "AGM ID required"),
  checkId: z.string().min(1, "Check ID required"),
  result: z.enum(["lulus", "gagal", "amaran"]),
  note: z.string().optional(),
});

export const complianceFindingSchema = z.object({
  agmId: z.string().min(1, "AGM ID required"),
  checkId: z.string().min(1, "Check ID required"),
  severity: z.enum(["critical", "major", "minor", "advisory"]),
  description: z.string().min(1, "Description required"),
  recommendation: z.string().optional(),
});

export const agmSchema = z.object({
  title: z.string().min(1, "Title required"),
  edition: z.number().int().positive("Edition must be positive integer"),
  fiscalYear: z.string().regex(/^\d{4}$/, "Fiscal year must be YYYY").optional(),
  scheduledAt: z.string().datetime("Invalid datetime"),
  venue: z.string().optional(),
  mode: z.enum(["physical", "hybrid", "virtual"]).default("hybrid"),
  quorumPct: z.number().min(0).max(100).default(25),
  noticeDays: z.number().int().min(1).default(21),
});

export const rulePackSchema = z.object({
  name: z.string().min(1, "Name required"),
  version: z.string().regex(/^\d+\.\d+\.\d$/, "Version must be semver"),
  description: z.string().optional(),
  checks: z.array(z.object({
    code: z.string().min(1),
    section: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    order: z.number().int().default(0),
    isMandatory: z.boolean().default(true),
  })).min(1, "At least one check required"),
});

export const invoiceSchema = z.object({
  organizationId: z.string().min(1),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().length(3).default("MYR"),
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).default("draft"),
  dueDate: z.string().datetime("Invalid due date"),
  description: z.string().optional(),
});

export const subscriptionSchema = z.object({
  organizationId: z.string().min(1),
  plan: z.enum(["starter", "professional", "enterprise"]),
  status: z.enum(["active", "cancelled", "past_due"]).default("active"),
  currentPeriodEnd: z.string().datetime("Invalid date"),
});

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(JSON.stringify(errors));
  }
  return result.data;
}