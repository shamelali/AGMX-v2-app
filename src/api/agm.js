/**
 * AGMX AGM Module
 * AGM lifecycle management
 */

import { pb, COLLECTIONS } from "./pb.js";
import { requireAuth, getOrganizationId } from "./auth.js";

export async function loadCurrentAGM(orgId) {
  const rec = await pb.collection(COLLECTIONS.agms).getFirstListItem(
    `organizationId = "${orgId}" && (status = "live" || status = "open" || status = "notice" || status = "closed" || status = "minuted")`
  );
  if (!rec) return null;
  
  const quorum = await pb.collection(COLLECTIONS.quorum).getFirstListItem(
    `agmId = "${rec.id}"`
  );
  const att = await pb
    .collection(COLLECTIONS.attendance)
    .getFullList({ filter: `agmId = "${rec.id}"` });

  return {
    id: rec.id,
    code: `AGM-${rec.edition}`,
    pbId: rec.id,
    title: rec.title,
    edition: `AGM Ke-${rec.edition}${rec.fiscalYear ? " (Tahun Kewangan " + rec.fiscalYear + ")" : ""}`,
    date: rec.scheduledAt,
    time: "",
    venue: rec.venue || "",
    mode: rec.mode || "hybrid",
    status: (rec.status || "").toUpperCase(),
    startedAt: rec.startedAt || "",
    elapsed: "",
    quorumPct: quorum ? Number(quorum.pct) : 0,
    quorumRequired: quorum
      ? Math.ceil((quorum.totalMembers * Number(rec.quorumPct)) / 100)
      : 0,
    quorumPresent: att.items.length,
    totalMembers: quorum ? quorum.totalMembers : 0,
    lateNoticeDays: rec.noticeDays || 21,
    noticesSent: 0,
    noticesRead: 0,
    noticesOpened: 0,
  };
}

export async function createAGM(data) {
  requireAuth();
  const orgId = getOrganizationId();
  return pb.collection(COLLECTIONS.agms).create({
    ...data,
    organizationId: orgId,
  });
}

export async function updateAGM(id, data) {
  requireAuth();
  return pb.collection(COLLECTIONS.agms).update(id, data);
}

export async function startAGM(agmId) {
  requireAuth();
  return pb.collection(COLLECTIONS.agms).update(agmId, {
    status: "live",
    startedAt: new Date().toISOString(),
  });
}

export async function closeAGM(agmId) {
  requireAuth();
  return pb.collection(COLLECTIONS.agms).update(agmId, {
    status: "closed",
  });
}

export async function loadAGMHistory(orgId) {
  const list = await pb.collection(COLLECTIONS.agms).getFullList({
    filter: `organizationId = "${orgId}"`,
    sort: "-edition",
  });
  return list.items;
}