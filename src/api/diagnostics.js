/**
 * AGMX Diagnostics Module
 * Health checks and system diagnostics
 */

import { pb, COLLECTIONS } from "./pb.js";
import { requireAuth, getOrganizationId, requireCommercialStaff, requireGovtStaff } from "./auth.js";

export async function runHealthCheck() {
  const checks = [];
  
  // PB connection
  try {
    await pb.health.check();
    checks.push({ name: "pocketbase", status: "ok" });
  } catch (e) {
    checks.push({ name: "pocketbase", status: "fail", error: e.message });
  }
  
  // Auth
  const token = localStorage.getItem("pb_token");
  checks.push({ name: "auth", status: token ? "ok" : "fail", detail: token ? "authenticated" : "not authenticated" });
  
  // HTTPS
  checks.push({ 
    name: "https", 
    status: location.protocol === "https:" ? "ok" : "warn", 
    detail: location.protocol 
  });
  
  // Crypto
  checks.push({ 
    name: "crypto", 
    status: window.crypto?.subtle ? "ok" : "fail",
    detail: window.crypto?.subtle ? "available" : "unavailable"
  });
  
  return { timestamp: new Date().toISOString(), checks };
}

export async function runOrgDiagnostics(orgId) {
  requireAuth();
  const ctx = getOrganizationId();
  
  const org = await pb.collection(COLLECTIONS.organizations).getOne(orgId);
  const members = await pb.collection(COLLECTIONS.members).getFullList({ 
    filter: `organizationId = "${orgId}"` 
  });
  const agms = await pb.collection(COLLECTIONS.agms).getFullList({ 
    filter: `organizationId = "${orgId}"` 
  });
  const docs = await pb.collection(COLLECTIONS.documents).getFullList({ 
    filter: `organizationId = "${orgId}"` 
  });
  
  return {
    organizationId: orgId,
    organization: org.name,
    memberCount: members.items.length,
    agmCount: agms.items.length,
    documentCount: docs.items.length,
    hasRulePack: !!org.ruleProfileId,
    subscriptionStatus: org.subscriptionStatus,
    timestamp: new Date().toISOString(),
  };
}

export async function runCommercialDiagnostics() {
  requireCommercialStaff();
  const orgs = await pb.collection(COLLECTIONS.organizations).getFullList();
  
  const orgRollups = [];
  for (const org of orgs.items) {
    const members = await pb.collection(COLLECTIONS.members).getFullList({ 
      filter: `organizationId = "${org.id}"` 
    });
    const agms = await pb.collection(COLLECTIONS.agms).getFullList({ 
      filter: `organizationId = "${org.id}"` 
    });
    orgRollups.push({
      id: org.id,
      name: org.name,
      memberCount: members.items.length,
      agmCount: agms.items.length,
      subscriptionStatus: org.subscriptionStatus,
    });
  }
  
  const memberTotal = orgRollups.reduce((sum, o) => sum + o.memberCount, 0);
  const agmCount = orgRollups.reduce((sum, o) => sum + o.agmCount, 0);
  
  return {
    organizations: orgRollups,
    memberTotal,
    totalMembers: memberTotal,
    agmCount,
    totalAgms: agmCount,
    timestamp: new Date().toISOString(),
  };
}

export async function runGovtDiagnostics() {
  requireGovtStaff();
  // Similar to commercial but with regulatory view
  return runCommercialDiagnostics();
}