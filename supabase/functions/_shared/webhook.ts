// supabase/functions/_shared/webhook.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Provider = "billplz" | "hitpay";

export interface VerifiedEvent {
  provider: Provider;
  provider_event_id: string;   // provider's payment/transaction id
  provider_status: string;     // e.g. "paid", "failed", "pending"
  amount_cents: number;
  currency: string;
  raw: unknown;
}

/** Timing-safe string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Billplz: X-Signature = HMAC-SHA256(sourceString, x_signature_key) */
export async function verifyBillplzSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, signature.toLowerCase());
}

/** HitPay: X-HitPay-Signature = HMAC-SHA256(rawBody, salt), hex */
export async function verifyHitpaySignature(
  rawBody: string,
  signature: string | null,
  salt: string,
): Promise<boolean> {
  if (!signature || !salt) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, signature.toLowerCase());
}

/**
 * Record webhook event atomically. Returns:
 *   { inserted: true }  -> first time, process it
 *   { inserted: false } -> duplicate, ack 200 and skip
 * Backed by a UNIQUE constraint on (provider, provider_event_id).
 */
export async function recordWebhookOnce(
  supabase: ReturnType<typeof createClient>,
  event: VerifiedEvent,
): Promise<{ inserted: boolean }> {
  const { error } = await supabase.from("webhook_events").insert({
    provider: event.provider,
    provider_event_id: event.provider_event_id,
    provider_status: event.provider_status,
    amount_cents: event.amount_cents,
    currency: event.currency,
    payload: event.raw,
  });
  if (!error) return { inserted: true };
  // 23505 = unique_violation -> duplicate delivery
  if ((error as { code?: string }).code === "23505") return { inserted: false };
  throw error;
}
