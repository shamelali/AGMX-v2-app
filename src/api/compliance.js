/**
 * AGMX Compliance Module
 * Rule packs, findings, and compliance checks
 */

import { pb, COLLECTIONS } from "./pb.js";
import { requireAuth, getOrganizationId, requireCommercialStaff } from "./auth.js";

const COMPLIANCE_RESULTS = ["lulus", "gagal", "amaran"];

export async function loadRulePack(packId, version) {
  return pb.collection(COLLECTIONS.rulePacks).getOne(packId);
}

export async function loadActiveRulePack(orgId) {
  const org = await pb.collection(COLLECTIONS.organizations).getOne(orgId);
  if (!org.ruleProfileId) return null;
  return pb.collection(COLLECTIONS.rulePacks).getOne(org.ruleProfileId);
}

export async function createRulePack(data) {
  requireCommercialStaff();
  return pb.collection(COLLECTIONS.rulePacks).create(data);
}

export async function switchRulePack(orgId, packId, version) {
  requireCommercialStaff();
  const pack = await pb.collection(COLLECTIONS.rulePacks).getOne(packId);
  if (pack.version !== version) {
    throw new Error("Version mismatch");
  }
  return pb.collection(COLLECTIONS.organizations).update(orgId, {
    ruleProfileId: packId,
    ruleProfileVersion: version,
  });
}

export async function loadComplianceProfile(orgId) {
  const org = await pb.collection(COLLECTIONS.organizations).getOne(orgId);
  if (!org.ruleProfileId) return null;
  
  const pack = await pb.collection(COLLECTIONS.rulePacks).getOne(org.ruleProfileId);
  const checks = await pb
    .collection(COLLECTIONS.complianceChecks)
    .getFullList({ filter: `rulePackId = "${pack.id}"`, sort: "section,order" });
  
  return {
    pack: { id: pack.id, version: pack.version, ruleProfileId: org.ruleProfileId },
    domainPackId: pack.id,
    domainPackVersion: pack.version,
    checks: checks.items,
  };
}

export async function upsertComplianceResult(data) {
  requireAuth();
  const { agmId, checkId, result, note } = data;
  
  if (!COMPLIANCE_RESULTS.includes(result)) {
    throw new Error("Invalid compliance result");
  }
  
  const existing = await pb
    .collection(COLLECTIONS.complianceResults)
    .getFirstListItem(`agmId = "${agmId}" && checkId = "${checkId}"`)
    .catch(() => null);
  
  if (existing) {
    return pb.collection(COLLECTIONS.complianceResults).update(existing.id, {
      result,
      note: note || "",
      decidedAt: new Date().toISOString(),
    });
  }
  
  return pb.collection(COLLECTIONS.complianceResults).create({
    agmId,
    checkId,
    result,
    note: note || "",
    decidedAt: new Date().toISOString(),
  });
}

export async function loadComplianceResults(agmId) {
  const list = await pb
    .collection(COLLECTIONS.complianceResults)
    .getFullList({ filter: `agmId = "${agmId}"` });
  return list.items;
}

export async function createComplianceFinding(data) {
  requireAuth();
  return pb.collection(COLLECTIONS.complianceFindings).create(data);
}

export async function loadComplianceFindings(agmId) {
  const list = await pb
    .collection(COLLECTIONS.complianceFindings)
    .getFullList({ filter: `agmId = "${agmId}"` });
  return list.items;
}