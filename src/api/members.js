/**
 * AGMX Members Module
 * Member CRUD, import/export, and search
 */

import { pb, COLLECTIONS, mapMember } from "./pb.js";
import { requireAuth, getOrganizationId } from "./auth.js";

export async function loadMembers(orgId) {
  const list = await pb.collection(COLLECTIONS.members).getFullList({
    filter: `organizationId = "${orgId}"`,
    sort: "memberNo",
  });
  return list.items.map(mapMember);
}

export async function createMember(data) {
  requireAuth();
  const orgId = getOrganizationId();
  return pb.collection(COLLECTIONS.members).create({
    ...data,
    organizationId: orgId,
  });
}

export async function updateMember(id, data) {
  requireAuth();
  return pb.collection(COLLECTIONS.members).update(id, data);
}

export async function deleteMember(id) {
  requireAuth();
  return pb.collection(COLLECTIONS.members).delete(id);
}

export async function importMembers(members) {
  requireAuth();
  const orgId = getOrganizationId();
  const results = [];
  for (const m of members) {
    const rec = await pb.collection(COLLECTIONS.members).create({
      ...m,
      organizationId: orgId,
    });
    results.push(rec);
  }
  return results;
}

export async function exportMembers(orgId) {
  requireAuth();
  const list = await loadMembers(orgId);
  return list.map((m) => ({
    memberNo: m.memberNo,
    name: m.name,
    ic: m.ic,
    email: m.email,
    phone: m.phone,
    address: m.address,
    joinDate: m.joinDate,
    status: m.status,
  }));
}

export async function searchMembers(orgId, query) {
  const list = await pb.collection(COLLECTIONS.members).getFullList({
    filter: `organizationId = "${orgId}" && (name ~ "${query}" || ic ~ "${query}" || email ~ "${query}")`,
    sort: "memberNo",
  });
  return list.items.map(mapMember);
}