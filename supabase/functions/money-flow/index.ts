/**
 * AGMX Money Flow — Supabase Edge Functions (Security Hardened)
 * Replaces PocketBase pb_hooks/money_flow.pb.js
 *
 * Endpoints:
 *   POST /functions/v1/money-flow/assessment       - Submit assessment → create lead (public, rate-limited)
 *   POST /functions/v1/money-flow/quote            - Generate quote from assessment
 *   POST /functions/v1/money-flow/quote/accept     - Accept a quote
 *   POST /functions/v1/money-flow/invoice          - Create invoice from accepted quote
 *   POST /functions/v1/money-flow/payment/intent   - Create payment intent (FPX/Card/Bank transfer)
 *   POST /functions/v1/money-flow/payment/confirm  - Confirm payment (signed gateway webhook)
 *   POST /functions/v1/money-flow/payment/manual-confirm - Settle bank transfer (operator)
 *   POST /functions/v1/money-flow/lead/stage       - Move a lead's pipeline stage (operator)
 *   GET  /functions/v1/money-flow/lead/:id         - Get lead status (operator or prospect token)
 *   GET  /functions/v1/money-flow/quote/:id        - Get quote by UUID or QT number
 *   GET  /functions/v1/money-flow/invoice/:id      - Get invoice by UUID or INV number
 *   GET  /functions/v1/money-flow/audit            - Audit trail for a lead/ref (operator or prospect token)
 *   GET  /functions/v1/money-flow/deals            - Pipeline deals (operator)
 *   GET  /functions/v1/money-flow/metrics          - Pipeline metrics (operator)
 *
 * Auth: operators use the Supabase session JWT; prospects use the checkout
 * token on the assessment (`?ref=LD-xxxx&t=...`). See resolveAuthContext().
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Use secret key (new API key format) instead of service_role_key
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const BILLPLZ_API_KEY = Deno.env.get("BILLPLZ_API_KEY") || ""
const BILLPLZ_COLLECTION_ID = Deno.env.get("BILLPLZ_COLLECTION_ID") || ""
/* Sandbox is the default until production credentials are set. */
const BILLPLZ_API_URL = (Deno.env.get("BILLPLZ_API_URL") || "https://www.billplz-sandbox.com").replace(/\/+$/, "")
const BILLPLZ_X_SIGNATURE = Deno.env.get("BILLPLZ_X_SIGNATURE") || ""
const HITPAY_API_KEY = Deno.env.get("HITPAY_API_KEY") || ""
const HITPAY_SALT = Deno.env.get("HITPAY_SALT") || ""
const HITPAY_API_URL = Deno.env.get("HITPAY_API_URL") || "https://api.sandbox.hit-pay.com"
const APP_URL = Deno.env.get("APP_URL") || "https://agmx-v2-app.vercel.app"

// Use service_role key (auto-injected by Supabase Edge Functions runtime)
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

// ---- Types ----
interface AssessmentInput {
  coopName: string
  coopReg?: string
  state?: string
  members: number
  agmDate?: string
  mode: "physical" | "online" | "hybrid"
  expectedAttendance?: number
  candidates: number
  motions: number
  currentProcess: "manual" | "partial" | "digital"
  needsManaged: boolean
  contactName: string
  contactPhone: string
  contactEmail?: string
}

interface QuoteInput {
  assessmentId: string
  planCode: string
  validDays?: number
}

interface PaymentIntentInput {
  invoiceId: string
  method: "fpx" | "card" | "bank_transfer"
  returnUrl?: string
  callbackUrl?: string
}

// ---- Helpers ----
function errorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

/* Resolve request context: operator JWT first, then prospect checkout token.
   A checkout token is a random UUID stored in agm_assessments.token, NOT a
   JWT — it is verified against the assessment row, not via supabase.auth. */
async function resolveAuthContext(req: Request) {
  const user = await getAuthUser(req)
  if (user) {
    const profile = await getUserOrgAndRole(user.id)
    return { user, profile, isProspect: false, assessment: null }
  }

  const url = new URL(req.url)
  const token = url.searchParams.get("t")
  const ref = url.searchParams.get("ref")
  if (token && ref) {
    const { data: assessment } = await supabase
      .from("agm_assessments")
      .select("*")
      .eq("reference", ref)
      .eq("token", token)
      .single()
    if (assessment) {
      return { user: null, profile: null, isProspect: true, assessment }
    }
  }

  return { user: null, profile: null, isProspect: false, assessment: null }
}

/* Ensure an organization exists for a prospect's cooperative so that
   quotes/invoices/payments (which require NOT NULL organization_id) can be
   created, and claim the assessment for that org. Returns the org UUID. */
async function ensureOrganization(assessment: any): Promise<string> {
  const slug = "coop-" + (assessment.reference || assessment.id).toLowerCase().replace(/[^a-z0-9]/g, "-")
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  if (existing?.id) return await claimAssessment(existing.id, assessment)

  const { data: org, error } = await supabase
    .from("organizations")
    .insert({
      slug,
      name: assessment.coop_name,
      registration_no: assessment.coop_reg || null,
      state: assessment.state || null,
      plan: "starter",
      status: "active",
    })
    .select("id")
    .single()

  if (org?.id) return await claimAssessment(org.id, assessment)
  // Unique-violation race: another request created it between our checks.
  const { data: retry } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  if (retry?.id) return await claimAssessment(retry.id, assessment)
  throw new Error("Failed to create organization: " + (error?.message ?? "unknown"))
}

async function claimAssessment(orgId: string, assessment: any): Promise<string> {
  if (assessment.organization_id !== orgId) {
    await supabase
      .from("agm_assessments")
      .update({ organization_id: orgId })
      .eq("id", assessment.id)
  }
  return orgId
}

function successResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

// Verify JWT and get user - use app_metadata for roles (not user_metadata)
async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return null
  const token = authHeader.replace("Bearer ", "")
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}

// Check admin/secretary role from app_metadata (trusted server-managed)
async function getUserOrgAndRole(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", userId)
    .single()
  return profile
}

function isAdminOrSecretary(profile: any): boolean {
  // Check app_metadata for trusted role (not user_metadata which user can edit)
  const appRole = profile?.app_metadata?.role || profile?.role
  return ["admin", "secretary"].includes(appRole)
}

function generateRef(prefix: string) {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${ts}-${rand}`
}

// ---- Complexity Scoring (matches assessment.js) ----
function computeComplexityScore(input: AssessmentInput): number {
  let score = 0
  score += Math.min(input.members / 20, 30)
  score += Math.min(input.candidates * 3, 15)
  score += Math.min(input.motions * 2, 15)
  score += input.mode === "hybrid" ? 10 : input.mode === "online" ? 5 : 0
  score += input.currentProcess === "manual" ? 10 : input.currentProcess === "partial" ? 5 : 0
  score += input.needsManaged ? 10 : 0
  score += input.expectedAttendance ? Math.min(input.expectedAttendance / 50, 10) : 0
  return Math.min(Math.round(score), 100)
}

function recommendPlan(score: number): string {
  if (score <= 34) return "essential_agm"
  if (score <= 64) return "professional_agm"
  return "enterprise_agm"
}

const PLAN_PRICING: Record<string, { oneoff: number; name: string }> = {
  essential_agm: { oneoff: 1500, name: "Essential AGM" },
  professional_agm: { oneoff: 3500, name: "Professional AGM" },
  enterprise_agm: { oneoff: 7500, name: "Enterprise AGM" },
  governance_os_essential: { oneoff: 0, name: "Governance OS Essential" },
  governance_os_professional: { oneoff: 0, name: "Governance OS Professional" },
  governance_os_enterprise: { oneoff: 0, name: "Governance OS Enterprise" },
  governance_os_federation: { oneoff: 0, name: "Governance OS Federation" },
}

const TAX_RATE = 0.08

// ---- Billplz Integration ----
async function createBillplzBill(invoiceId: string, amount: number, description: string, email: string, payerName: string, callbackUrl: string, redirectUrl?: string) {
  if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID) {
    throw new Error("Billplz not configured")
  }
  /* Billplz expects form-encoded parameters; name, email and collection_id
     are required or the bill is rejected. Amount is in cents. */
  const body = new URLSearchParams({
    collection_id: BILLPLZ_COLLECTION_ID,
    description,
    email,
    name: payerName || "AGMX",
    amount: String(Math.round(amount * 100)),
    callback_url: callbackUrl,
    redirect_url: redirectUrl || `${APP_URL}/checkout.html?invoice=${invoiceId}&status=success`,
    reference_1_label: "Invoice",
    reference_1: invoiceId,
  })
  const resp = await fetch(`${BILLPLZ_API_URL}/api/v3/bills`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(BILLPLZ_API_KEY + ":")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Billplz error: ${err}`)
  }
  return resp.json()
}

// ---- HitPay Integration ----
async function createHitPayPayment(invoiceId: string, amount: number, description: string, email: string, returnUrl: string) {
  if (!HITPAY_API_KEY || !HITPAY_SALT) {
    throw new Error("HitPay not configured")
  }
  const body = new URLSearchParams({
    amount: amount.toFixed(2),
    currency: "MYR",
    purpose: description,
    email,
    reference_number: invoiceId,
    redirect_url: returnUrl,
    send_sms: "false",
  })
  const resp = await fetch(`${HITPAY_API_URL}/v1/payment-requests`, {
    method: "POST",
    headers: {
      "X-BUSINESS-API-KEY": HITPAY_API_KEY,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`HitPay error: ${err}`)
  }
  return resp.json()
}

// ---- Audit Logging with proper error handling ----
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"

async function auditLog(orgId: string, actorId: string, action: string, entityType: string, entityId: string, payload: any) {
  /* Prospects hold no auth user, and assessment-time events predate the
     organization. Both columns are FKs, so a zero UUID must become null
     or every prospective audit row is rejected. */
  const org = orgId && orgId !== ZERO_UUID ? orgId : null
  const actor = actorId && actorId !== ZERO_UUID ? actorId : null

  let prevHash = "0".repeat(64)
  if (org) {
    const { data: lastEvent } = await supabase
      .from("audit_events")
      .select("hash")
      .eq("organization_id", org)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .single()
    if (lastEvent?.hash) prevHash = lastEvent.hash
  }

  const hashInput = prevHash + JSON.stringify(payload) + Date.now().toString()
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput))
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")

  const { error } = await supabase.from("audit_events").insert({
    organization_id: org,
    actor_id: actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    prev_hash: prevHash,
    hash,
  })
  
  if (error) {
    console.error("Audit log failed:", error)
  }
}

// ---- Rate Limiting with fail-closed behavior ----
async function checkRateLimit(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
             req.headers.get("x-real-ip") || 
             "unknown"
  
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_ip: ip,
      p_limit: 60,
      p_window: "1 minute"
    })
    if (error) {
      console.error("Rate limit check failed:", error)
      return false // Fail closed
    }
    return data === true
  } catch (err) {
    console.error("Rate limit RPC failed:", err)
    return false // Fail closed
  }
}

// ---- Handlers ----

async function handleAssessment(req: Request) {
  // Rate limiting
  if (!(await checkRateLimit(req))) {
    return errorResponse("Rate limit exceeded", 429)
  }

  const input: AssessmentInput = await req.json()
  
  if (!input.coopName || !input.contactName || !input.contactPhone) {
    return errorResponse("Missing required fields: coopName, contactName, contactPhone")
  }
  if (input.members < 1) {
    return errorResponse("Members must be at least 1")
  }

  const complexityScore = computeComplexityScore(input)
  const recommendedPlanCode = recommendPlan(complexityScore)

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("code", recommendedPlanCode)
    .single()

  const { data: assessment, error } = await supabase
    .from("agm_assessments")
    .insert({
      coop_name: input.coopName,
      coop_reg: input.coopReg,
      state: input.state,
      members: input.members,
      agm_date: input.agmDate,
      mode: input.mode,
      expected_attendance: input.expectedAttendance,
      candidates: input.candidates,
      motions: input.motions,
      current_process: input.currentProcess,
      needs_managed: input.needsManaged,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      contact_email: input.contactEmail,
      complexity_score: complexityScore,
      recommended_plan: plan?.id,
      status: "lead",
      reference: generateRef("LD"),
      token: crypto.randomUUID(),
    })
    .select()
    .single()

  if (error) return errorResponse(error.message, 500)

  await auditLog(
    "00000000-0000-0000-0000-000000000000",
    "00000000-0000-0000-0000-000000000000",
    "assessment.submitted",
    "agm_assessment",
    assessment.id,
    { complexityScore, recommendedPlanCode }
  )

  return successResponse({
    assessmentId: assessment.id,
    reference: assessment.reference,
    token: assessment.token,
    complexityScore,
    recommendedPlan: recommendedPlanCode,
    quoteUrl: `${APP_URL}/checkout.html?ref=${assessment.reference}&t=${assessment.token}`,
  }, 201)
}

async function handleQuote(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)
  if (ctx.user && ctx.profile && !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  const input: QuoteInput = await req.json()

  let assessmentId = input.assessmentId
  let orgId = ctx.profile?.organization_id || null
  let assessment = ctx.assessment

  if (ctx.isProspect) {
    assessmentId = ctx.assessment.id
    orgId = await ensureOrganization(ctx.assessment)
    assessment = ctx.assessment
  } else {
    const { data: a } = await supabase
      .from("agm_assessments")
      .select("*")
      .eq("id", input.assessmentId)
      .single()
    if (!a) return errorResponse("Assessment not found", 404)
    assessment = a
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("code", input.planCode)
    .single()
  if (!plan) return errorResponse("Invalid plan", 400)

  const subtotal = plan.price_oneoff || 0
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100
  const total = subtotal + tax
  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + (input.validDays || 30))

  const quoteNumber = generateRef("QT")

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      organization_id: orgId,
      assessment_id: assessmentId,
      number: quoteNumber,
      status: "draft",
      valid_until: validUntil.toISOString().split("T")[0],
      subtotal,
      tax,
      total,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message, 500)

  await supabase.from("quote_items").insert({
    quote_id: quote.id,
    plan_id: plan.id,
    description: plan.name,
    quantity: 1,
    unit_price: subtotal,
    line_total: subtotal,
  })

  await supabase
    .from("agm_assessments")
    .update({ status: "quoted" })
    .eq("id", assessmentId)

  await auditLog(orgId || "00000000-0000-0000-0000-000000000000", ctx.user?.id || "00000000-0000-0000-0000-000000000000", "quote.created", "quote", quote.id, {
    assessmentId,
    planCode: input.planCode,
    total,
  })

  return successResponse({
    quoteId: quote.id,
    number: quote.number,
    total,
    validUntil: quote.valid_until,
    checkoutUrl: `${APP_URL}/checkout.html?ref=${assessment.reference}&t=${assessment.token}`,
  }, 201)
}

async function handleQuoteAccept(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)
  if (ctx.user && (!ctx.profile || !isAdminOrSecretary(ctx.profile))) {
    return errorResponse("Operator access required", 403)
  }

  const { quoteId } = await req.json()
  if (!quoteId) return errorResponse("Missing quoteId")

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, assessment_id, organization_id")
    .eq("id", quoteId)
    .single()
  if (!quote) return errorResponse("Quote not found", 404)

  if (ctx.isProspect && quote.assessment_id !== ctx.assessment.id) {
    return errorResponse("Forbidden", 403)
  }
  if (ctx.user && ctx.profile && quote.organization_id !== ctx.profile.organization_id) {
    return errorResponse("Forbidden", 403)
  }

  if (quote.status === "accepted" || quote.status === "invoiced") {
    return successResponse({ quoteId: quote.id, number: quote.number, status: "accepted" })
  }

  const { error: uErr } = await supabase
    .from("quotes")
    .update({ status: "accepted" })
    .eq("id", quoteId)
  if (uErr) return errorResponse(uErr.message, 500)

  await supabase
    .from("agm_assessments")
    .update({ status: "accepted" })
    .eq("id", quote.assessment_id)

  await auditLog(quote.organization_id || "00000000-0000-0000-0000-000000000000", ctx.user?.id || "00000000-0000-0000-0000-000000000000", "quote.accepted", "quote", quoteId, {
    quoteId, assessmentId: quote.assessment_id,
  })

  return successResponse({ quoteId: quote.id, number: quote.number, status: "accepted" }, 200)
}

async function handleInvoice(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)
  if (ctx.user && ctx.profile && !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  const { quoteId } = await req.json()

  let orgId = ctx.profile?.organization_id || null
  let assessmentId: string | null = null

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, assessment_id, organization_id")
    .eq("id", quoteId)
    .single()
  if (!quote) return errorResponse("Quote not found", 404)

  if (ctx.isProspect) {
    orgId = await ensureOrganization(ctx.assessment)
    assessmentId = quote.assessment_id
    // verify the quote belongs to the prospect's assessment
    if (quote.assessment_id !== ctx.assessment.id) return errorResponse("Forbidden", 403)
  } else {
    if (ctx.profile && quote.organization_id !== ctx.profile.organization_id) {
      return errorResponse("Forbidden", 403)
    }
    orgId = quote.organization_id
    assessmentId = quote.assessment_id
  }

  if (quote.status !== "accepted") {
    return errorResponse("Quote must be accepted first", 400)
  }

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 14)
  const invoiceNumber = generateRef("INV")

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: orgId,
      quote_id: quoteId,
      number: invoiceNumber,
      status: "unpaid",
      issued_at: new Date().toISOString().split("T")[0],
      due_at: dueDate.toISOString().split("T")[0],
      amount: quote.total,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message, 500)

  await supabase.from("quotes").update({ status: "invoiced" }).eq("id", quoteId)
  if (assessmentId) {
    await supabase.from("agm_assessments").update({ status: "invoiced" }).eq("id", assessmentId)
  }

  await auditLog(orgId || "00000000-0000-0000-0000-000000000000", ctx.user?.id || "00000000-0000-0000-0000-000000000000", "invoice.created", "invoice", invoice.id, {
    quoteId,
    amount: quote.total,
  })

  return successResponse({
    invoiceId: invoice.id,
    number: invoice.number,
    amount: invoice.amount,
    dueAt: invoice.due_at,
    paymentUrl: `${APP_URL}/checkout.html?invoice=${invoice.id}`,
  }, 201)
}

async function handlePaymentIntent(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)

  const input: PaymentIntentInput = await req.json()

  /* Accept either the invoice UUID or its INV-… number (checkout passes numbers). */
  let { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", input.invoiceId)
    .single()
  if (!invoice) {
    ;({ data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("number", input.invoiceId)
      .single())
  }
  if (!invoice) return errorResponse("Invoice not found", 404)

  let orgId = invoice.organization_id
  if (ctx.isProspect) {
    orgId = await ensureOrganization(ctx.assessment)
    if (invoice.organization_id !== orgId) return errorResponse("Forbidden", 403)
  } else if (ctx.profile && invoice.organization_id !== ctx.profile.organization_id) {
    return errorResponse("Forbidden", 403)
  }

  if (invoice.status === "paid") {
    return errorResponse("Invoice already paid", 400)
  }

  const paymentRef = generateRef("PAY")
  // The gateway posts its confirmation to this function, so the URL has to come from
  // the function's own request — APP_URL is the web app, which has no /functions/v1
  // route and answers 405, leaving a paid invoice stuck as unpaid.
  const self = new URL(req.url)
  const callbackUrl = input.callbackUrl ||
    `${self.origin}${self.pathname.replace(/payment\/intent$/, "payment/confirm")}`
  /* Prospects must land back on checkout with their ?ref&t context so the
     token-gated resume can fetch the settled deal. */
  const prospectCtx = ctx.isProspect
    ? `&ref=${encodeURIComponent(ctx.assessment.reference)}&t=${encodeURIComponent(ctx.assessment.token)}`
    : ""
  const returnUrl = input.returnUrl ||
    `${APP_URL}/checkout.html?invoice=${invoice.number}&status=success${prospectCtx}`

  let paymentUrl = ""
  let gatewayRef = ""

  if (input.method === "fpx") {
    const bill = await createBillplzBill(
      invoice.id,
      invoice.amount,
      `AGMX Invoice ${invoice.number}`,
      ctx.user?.email || ctx.assessment?.contact_email || "",
      ctx.assessment?.contact_name || "AGMX Customer",
      callbackUrl,
      returnUrl
    )
    paymentUrl = bill.url
    gatewayRef = bill.id
  } else if (input.method === "card") {
    const payment = await createHitPayPayment(
      invoice.id,
      invoice.amount,
      `AGMX Invoice ${invoice.number}`,
      ctx.user?.email || ctx.assessment?.contact_email || "",
      returnUrl
    )
    paymentUrl = payment.url
    gatewayRef = payment.id
  } else {
    paymentUrl = `${APP_URL}/checkout.html?invoice=${invoice.id}&method=bank_transfer`
  }

  const { data: payment } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoice.id,
      organization_id: orgId,
      method: input.method,
      reference: gatewayRef || paymentRef,
      amount: invoice.amount,
      status: "pending",
    })
    .select()
    .single()

  await auditLog(orgId || "00000000-0000-0000-0000-000000000000", ctx.user?.id || "00000000-0000-0000-0000-000000000000", "payment.intent_created", "payment", payment.id, {
    invoiceId: invoice.id,
    method: input.method,
    gatewayRef,
  })

  return successResponse({
    paymentId: payment.id,
    paymentUrl,
    gatewayRef,
    method: input.method,
  })
}

/* ---- POST /payment/manual-confirm (operator settles a pending transfer) ---- */
async function handlePaymentManualConfirm(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user || !ctx.profile || !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  const { paymentId } = await req.json()
  if (!paymentId) return errorResponse("Missing paymentId")

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single()
  if (!payment) return errorResponse("Payment not found", 404)
  if (payment.organization_id !== ctx.profile.organization_id) {
    return errorResponse("Forbidden", 403)
  }
  if (payment.status === "succeeded") return successResponse({ payment })

  const paidAt = new Date().toISOString()
  await supabase.from("payments").update({ status: "succeeded", paid_at: paidAt }).eq("id", paymentId)
  await supabase.from("invoices").update({ status: "paid", paid_at: paidAt }).eq("id", payment.invoice_id)

  const { data: invoice } = await supabase
    .from("invoices")
    .select("quote_id")
    .eq("id", payment.invoice_id)
    .single()
  if (invoice?.quote_id) {
    const { data: quote } = await supabase
      .from("quotes")
      .select("assessment_id")
      .eq("id", invoice.quote_id)
      .single()
    if (quote?.assessment_id) {
      await supabase.from("agm_assessments").update({ status: "paid" }).eq("id", quote.assessment_id)
    }
  }

  await auditLog(payment.organization_id, ctx.user.id, "payment.succeeded", "payment", paymentId, {
    invoiceId: payment.invoice_id,
    method: payment.method,
    reference: payment.reference,
    amount: payment.amount,
    confirmedBy: "operator",
  })

  const { data: updated } = await supabase.from("payments").select("*").eq("id", paymentId).single()
  return successResponse({ payment: updated })
}

/* ---- POST /lead/stage ---- */
async function handleLeadStage(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user || !ctx.profile || !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  const { ref, stage } = await req.json()
  if (!ref || !stage) return errorResponse("Missing ref or stage")

  let { data: assessment } = await supabase
    .from("agm_assessments")
    .select("id, organization_id, status")
    .eq("id", ref)
    .single()
  if (!assessment) {
    ;({ data: assessment } = await supabase
      .from("agm_assessments")
      .select("id, organization_id, status")
      .eq("reference", ref)
      .single())
  }
  if (!assessment) return errorResponse("Lead not found", 404)

  await supabase.from("agm_assessments").update({ status: stage }).eq("id", assessment.id)

  await auditLog(assessment.organization_id || "00000000-0000-0000-0000-000000000000", ctx.user.id, "lead.stage_changed", "agm_assessment", assessment.id, {
    from: assessment.status, to: stage,
  })

  return successResponse({ id: assessment.id, stage })
}

// ---- Webhook signature helpers ----
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
}

async function billplzSignature(params: Record<string, string>, key: string): Promise<string> {
  const pairs = Object.keys(params)
    .filter(k => k !== "x_signature")
    .sort()
    .map(k => k + params[k])
    .join("|")
  return hmacSha256Hex(key, pairs)
}

async function handlePaymentConfirm(req: Request) {
  const url = new URL(req.url)
  const gateway = url.searchParams.get("gateway") || "billplz"
  const raw = await req.text()

  let params: Record<string, any> = {}
  const contentType = req.headers.get("content-type") || ""
  if (contentType.includes("application/x-www-form-urlencoded")) {
    params = Object.fromEntries(new URLSearchParams(raw))
  } else {
    params = JSON.parse(raw)
  }

  // Verify signatures BEFORE trusting anything. Fail closed when the signing
  // key is not configured.
  if (gateway === "billplz") {
    if (!BILLPLZ_X_SIGNATURE) return errorResponse("BILLPLZ_X_SIGNATURE not configured", 500)
    const expected = await billplzSignature(params, BILLPLZ_X_SIGNATURE)
    if (!safeEqual(expected, String(params.x_signature || ""))) {
      return errorResponse("Invalid x_signature", 403)
    }
  } else if (gateway === "hitpay") {
    if (!HITPAY_SALT) return errorResponse("HITPAY_SALT not configured", 500)
    const expected = await hmacSha256Hex(HITPAY_SALT, raw)
    if (!safeEqual(expected, req.headers.get("hitpay-signature") || "")) {
      return errorResponse("Invalid Hitpay-Signature", 403)
    }
  } else {
    return errorResponse("Unknown gateway", 400)
  }

  const method = gateway === "billplz" ? "fpx" : "card"
  let invoiceId = ""
  let gatewayRef = ""
  let txnId = ""
  let status = "pending"
  let paidAt = new Date().toISOString()

  if (gateway === "billplz") {
    invoiceId = params.reference_1
    gatewayRef = params.id
    txnId = params.transaction_id || ""
    status = String(params.paid) === "true" ? "succeeded" : "failed"
    if (params.paid_at) paidAt = new Date(params.paid_at).toISOString()
  } else {
    invoiceId = params.reference_number
    gatewayRef = params.id
    txnId = params.payments?.[0]?.id || ""
    status = params.status === "completed" ? "succeeded" : "failed"
  }

  if (!invoiceId) return errorResponse("Missing invoice reference", 400)

  // Idempotency: Use transaction to ensure atomicity
  const { data: existing } = await supabase
    .from("payments")
    .select("id, status, organization_id, amount")
    .eq("invoice_id", invoiceId)
    .eq("method", method)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.status === "succeeded") {
    return successResponse({ success: true, status: "duplicate" })
  }

  // Use RPC for atomic payment processing
  const { error: rpcError } = await supabase.rpc("process_payment_webhook", {
    p_invoice_id: invoiceId,
    p_method: method,
    p_gateway_ref: gatewayRef,
    p_txn_id: txnId,
    p_status: status,
    p_paid_at: paidAt,
    p_gateway: gateway,
  })

  if (rpcError) {
    console.error("RPC error:", rpcError)
    return errorResponse("Payment processing failed", 500)
  }

  return successResponse({ success: true, status })
}

/* ---- GET /quote/:id ---- */
async function handleQuoteGet(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)

  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()

  let { data: quote } = await supabase
    .from("quotes")
    .select("*, quote_items(*), agm_assessments ( reference, token )")
    .eq("id", id)
    .single()
  if (!quote) {
    ;({ data: quote } = await supabase
      .from("quotes")
      .select("*, quote_items(*), agm_assessments ( reference, token )")
      .eq("number", id)
      .single())
  }
  if (!quote) return errorResponse("Quote not found", 404)

  if (ctx.isProspect) {
    const orgId = await ensureOrganization(ctx.assessment)
    if (quote.organization_id !== orgId) return errorResponse("Forbidden", 403)
  } else if (ctx.profile && quote.organization_id !== ctx.profile.organization_id) {
    return errorResponse("Forbidden", 403)
  }

  return successResponse(quote)
}

/* ---- GET /invoice/:id ---- */
async function handleInvoiceGet(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)

  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()

  let { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single()
  if (!invoice) {
    ;({ data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("number", id)
      .single())
  }
  if (!invoice) return errorResponse("Invoice not found", 404)

  if (ctx.isProspect) {
    const orgId = await ensureOrganization(ctx.assessment)
    if (invoice.organization_id !== orgId) return errorResponse("Forbidden", 403)
  } else if (ctx.profile && invoice.organization_id !== ctx.profile.organization_id) {
    return errorResponse("Forbidden", 403)
  }

  return successResponse(invoice)
}

/* ---- GET /audit ---- */
async function handleAudit(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)

  const url = new URL(req.url)
  const ref = url.searchParams.get("ref")

  let entityIds: string[] = []
  if (ref) {
    let { data: assessment } = await supabase
      .from("agm_assessments")
      .select("id, organization_id")
      .eq("id", ref)
      .single()
    if (!assessment) {
      ;({ data: assessment } = await supabase
        .from("agm_assessments")
        .select("id, organization_id")
        .eq("reference", ref)
        .single())
    }
    if (!assessment) return successResponse([])
    if (ctx.isProspect && assessment.id !== ctx.assessment.id) {
      return errorResponse("Forbidden", 403)
    }
    /* Operators see their own org's leads plus unclaimed ones (same rule
       as GET /deals), never another tenant's. */
    if (!ctx.isProspect && ctx.profile && assessment.organization_id &&
        assessment.organization_id !== ctx.profile.organization_id) {
      return errorResponse("Forbidden", 403)
    }

    entityIds.push(assessment.id)
    const { data: quotes } = await supabase
      .from("quotes")
      .select("id")
      .eq("assessment_id", assessment.id)
    const quoteIds = (quotes || []).map((q: any) => q.id)
    entityIds.push(...quoteIds)

    if (quoteIds.length) {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("id")
        .in("quote_id", quoteIds)
      const invoiceIds = (invoices || []).map((i: any) => i.id)
      entityIds.push(...invoiceIds)

      if (invoiceIds.length) {
        const { data: payments } = await supabase
          .from("payments")
          .select("id")
          .in("invoice_id", invoiceIds)
        entityIds.push(...(payments || []).map((p: any) => p.id))
      }
    }
  } else if (!ctx.isProspect && ctx.profile) {
    const { data: events } = await supabase
      .from("audit_events")
      .select("*")
      .eq("organization_id", ctx.profile.organization_id)
      .order("occurred_at", { ascending: false })
    return successResponse((events || []).map(mapAuditEvent))
  } else {
    return errorResponse("Forbidden", 403)
  }

  const { data: events } = await supabase
    .from("audit_events")
    .select("*")
    .in("entity_id", entityIds)
    .order("occurred_at", { ascending: false })

  return successResponse((events || []).map(mapAuditEvent))
}

function mapAuditEvent(e: any) {
  return {
    id: e.id,
    ts: e.occurred_at,
    event: e.action,
    entityType: e.entity_type,
    entityId: e.entity_id,
    detail: e.payload,
  }
}

/* ---- GET /deals ---- */
/* PostgREST can only embed invoices/payments under a lead through quotes
   (payments → invoices → quotes → assessments). Flatten them back to the
   top level the client adapter reads. */
function flattenDeal(row: any) {
  const quotes = (row.quotes || []).slice().sort((x: any, y: any) =>
    String(y.created_at || "").localeCompare(String(x.created_at || "")))
  const invoices = quotes
    .flatMap((q: any) => q.invoices || [])
    .sort((x: any, y: any) => String(y.issued_at || "").localeCompare(String(x.issued_at || "")))
  const payments = invoices
    .flatMap((i: any) => i.payments || [])
    .sort((x: any, y: any) => String(y.created_at || "").localeCompare(String(x.created_at || "")))
  return { ...row, quotes, invoices, payments }
}

async function handleDeals(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user || !ctx.profile || !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  /* Raw assessment rows with nested documents — the client adapter maps
     them to the shared deal shape (camelCase + LD-/QT-/INV- references).
     Unclaimed leads (organization_id null) stay visible to the sales
     inbox until the prospect's first quote claims them. */
  const { data: assessments } = await supabase
    .from("agm_assessments")
    .select("*, quotes(*, invoices(*, payments(*)))")
    .or(`organization_id.eq.${ctx.profile.organization_id},organization_id.is.null`)
    .order("created_at", { ascending: false })

  return successResponse({ deals: (assessments || []).map(flattenDeal) })
}

async function handleLead(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user && !ctx.isProspect) return errorResponse("Unauthorized", 401)
  if (ctx.user && (!ctx.profile || !isAdminOrSecretary(ctx.profile))) {
    return errorResponse("Operator access required", 403)
  }

  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()

  /* Look up by UUID first, then by LD-xxxx reference so checkout links
     (?ref=LD-0007) resolve the same lead the assessment hook returned. */
  const leadSelect = `
    *,
    quotes ( *, invoices ( *, payments ( * ) ) )
  `

  let { data: assessment } = await supabase
    .from("agm_assessments")
    .select(leadSelect)
    .eq("id", id)
    .single()

  if (!assessment) {
    ;({ data: assessment } = await supabase
      .from("agm_assessments")
      .select(leadSelect)
      .eq("reference", id)
      .single())
  }

  if (!assessment) return errorResponse("Lead not found", 404)

  /* A prospect may only see their own assessment row. */
  if (ctx.isProspect && assessment.id !== ctx.assessment.id) {
    return errorResponse("Forbidden", 403)
  }

  return successResponse(flattenDeal(assessment))
}

async function handleMetrics(req: Request) {
  const ctx = await resolveAuthContext(req)
  if (!ctx.user || !ctx.profile || !isAdminOrSecretary(ctx.profile)) {
    return errorResponse("Operator access required", 403)
  }

  const { data: assessments } = await supabase
    .from("agm_assessments")
    .select("status, complexity_score, created_at")
    .or(`organization_id.eq.${ctx.profile.organization_id},organization_id.is.null`)
    .order("created_at", { ascending: false })

  const { data: quotes } = await supabase
    .from("quotes")
    .select("status, total, created_at")
    .eq("organization_id", ctx.profile.organization_id)
    .order("created_at", { ascending: false })

  const { data: invoices } = await supabase
    .from("invoices")
    .select("status, amount, issued_at, paid_at")
    .eq("organization_id", ctx.profile.organization_id)
    .order("issued_at", { ascending: false })

  const metrics = {
    totalLeads: assessments?.length || 0,
    byStatus: assessments?.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc }, {} as Record<string, number>) || {},
    avgComplexity: assessments?.length ? assessments.reduce((s, a) => s + a.complexity_score, 0) / assessments.length : 0,
    totalQuotes: quotes?.length || 0,
    quotesByStatus: quotes?.reduce((acc, q) => { acc[q.status] = (acc[q.status] || 0) + 1; return acc }, {} as Record<string, number>) || {},
    totalInvoices: invoices?.length || 0,
    invoicesByStatus: invoices?.reduce((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc }, {} as Record<string, number>) || {},
    revenueCollected: invoices?.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0) || 0,
    pipelineValue: quotes?.filter(q => q.status === "sent" || q.status === "accepted").reduce((s, q) => s + q.total, 0) || 0,
  }

  return successResponse(metrics)
}

// ---- Router ----
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // Rate limiting (fail closed)
  if (!(await checkRateLimit(req))) {
    return errorResponse("Rate limit exceeded", 429)
  }

  const url = new URL(req.url)
  /* The runtime has served this function under both
     /functions/v1/money-flow/<route> and /money-flow/<route>; normalize
     either prefix (or none) down to /<route>. */
  let path = url.pathname.replace(/^\/functions\/v1\/money-flow/, "")
  if (path.startsWith("/money-flow")) path = path.slice("/money-flow".length) || "/"
  if (!path.startsWith("/")) path = "/" + path
  const method = req.method

  try {
    if (method === "POST" && path === "/assessment") {
      return await handleAssessment(req)
    }
    if (method === "POST" && path === "/quote") {
      return await handleQuote(req)
    }
    if (method === "POST" && path === "/quote/accept") {
      return await handleQuoteAccept(req)
    }
    if (method === "POST" && path === "/invoice") {
      return await handleInvoice(req)
    }
    if (method === "POST" && path === "/payment/intent") {
      return await handlePaymentIntent(req)
    }
    if (method === "POST" && path === "/payment/confirm") {
      return await handlePaymentConfirm(req)
    }
    if (method === "POST" && path === "/payment/manual-confirm") {
      return await handlePaymentManualConfirm(req)
    }
    if (method === "POST" && path === "/lead/stage") {
      return await handleLeadStage(req)
    }
    if (method === "GET" && path.startsWith("/lead/")) {
      return await handleLead(req)
    }
    if (method === "GET" && path.startsWith("/quote/")) {
      return await handleQuoteGet(req)
    }
    if (method === "GET" && path.startsWith("/invoice/")) {
      return await handleInvoiceGet(req)
    }
    if (method === "GET" && path === "/audit") {
      return await handleAudit(req)
    }
    if (method === "GET" && path === "/deals") {
      return await handleDeals(req)
    }
    if (method === "GET" && path === "/metrics") {
      return await handleMetrics(req)
    }
    return errorResponse("Not found", 404)
  } catch (err) {
    console.error("Money flow error:", err)
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500)
  }
})