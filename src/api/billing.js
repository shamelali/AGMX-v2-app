/**
 * AGMX Billing Module
 * Invoices, subscriptions, and payments
 */

import { pb, COLLECTIONS } from "./pb.js";
import { requireAuth, getOrganizationId, requireCommercialStaff } from "./auth.js";

export async function loadInvoices(orgId) {
  const list = await pb.collection(COLLECTIONS.invoices).getFullList({
    filter: `organizationId = "${orgId}"`,
    sort: "-created",
  });
  return list.items;
}

export async function createInvoice(data) {
  requireCommercialStaff();
  const orgId = getOrganizationId();
  return pb.collection(COLLECTIONS.invoices).create({
    ...data,
    organizationId: orgId,
  });
}

export async function updateInvoice(id, data) {
  requireCommercialStaff();
  return pb.collection(COLLECTIONS.invoices).update(id, data);
}

export async function loadSubscriptions(orgId) {
  const list = await pb.collection(COLLECTIONS.subscriptions).getFullList({
    filter: `organizationId = "${orgId}"`,
    sort: "-created",
  });
  return list.items;
}

export async function createSubscription(data) {
  requireCommercialStaff();
  const orgId = getOrganizationId();
  return pb.collection(COLLECTIONS.subscriptions).create({
    ...data,
    organizationId: orgId,
  });
}

export async function cancelSubscription(id) {
  requireCommercialStaff();
  return pb.collection(COLLECTIONS.subscriptions).update(id, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
}

export async function loadPayments(orgId) {
  const list = await pb.collection(COLLECTIONS.payments).getFullList({
    filter: `organizationId = "${orgId}"`,
    sort: "-created",
  });
  return list.items;
}