/**
 * AGMX PocketBase Core
 * Shared client, collections, and mappers
 */

import PocketBase from "pocketbase";

export const pb = new PocketBase(
  (import.meta.env.VITE_PB_URL || "http://127.0.0.1:8090")
);

export const COLLECTIONS = {
  organizations: "organizations",
  members: "members",
  agms: "agms",
  attendance: "attendance",
  resolutions: "resolutions",
  votes: "votes",
  documents: "documents",
  rulePacks: "rule_packs",
  complianceChecks: "compliance_checks",
  complianceResults: "compliance_results",
  complianceFindings: "compliance_findings",
  invoices: "invoices",
  subscriptions: "subscriptions",
  payments: "payments",
  domains: "domains",
  domainPacks: "domain_packs",
};

export function mapMember(item) {
  return {
    id: item.id,
    pbId: item.id,
    memberNo: item.memberNo,
    name: item.name,
    ic: item.ic,
    email: item.email,
    phone: item.phone,
    address: item.address,
    joinDate: item.joinDate,
    status: item.status,
    organizationId: item.organizationId,
  };
}

export function mapDocument(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    filename: item.filename,
    mime: item.mime,
    sizeBytes: item.sizeBytes,
    uploadedAt: item.uploadedAt,
    uploadedBy: item.uploadedBy,
    agmId: item.agmId,
  };
}

export function mapResolution(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    status: item.status,
    agmId: item.agmId,
    proposerId: item.proposerId,
    seconderId: item.seconderId,
  };
}

export async function sha256Hex(str) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("SHA-256 requires secure context (HTTPS).");
  }
  const buf = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}