/**
 * AGMX Authentication Module
 * Handles login, token management, and session persistence
 */

// Token storage keys
const TOKEN_KEY = "pb_token";
const RECORD_KEY = "pb_auth_record";

export async function loginWithGoogle() {
  return pb.authWithGoogle();
}

export async function loginWithPassword(email, password) {
  return pb.authWithPassword(email, password);
}

export async function requestEmailOTP(email) {
  return pb.requestEmailOTP(email);
}

export async function verifyEmailOTP(email, otp) {
  return pb.verifyEmailOTP(email, otp);
}

export async function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(RECORD_KEY);
  pb.authStore.clear();
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getAuthRecord() {
  const raw = localStorage.getItem(RECORD_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!getToken();
}

export function requireAuth() {
  const record = getAuthRecord();
  if (!record) {
    throw new Error("Authentication required");
  }
  return record;
}

export function requireCommercialStaff() {
  const record = requireAuth();
  if (record.role !== "commercial_staff") {
    throw new Error("Commercial staff access required");
  }
  return record;
}

export function requireGovtStaff() {
  const record = requireAuth();
  if (record.role !== "govt_staff") {
    throw new Error("Government staff access required");
  }
  return record;
}

export function getOrganizationId() {
  const record = getAuthRecord();
  return record?.organizationId || null;
}