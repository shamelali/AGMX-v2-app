/**
 * AGMX Money Flow — Supabase Edge Functions
 * Replaces PocketBase pb_hooks/money_flow.pb.js
 * 
 * Endpoints:
 *   POST /functions/v1/money-flow/assessment   - Submit assessment → create lead
 *   POST /functions/v1/money-flow/quote        - Generate quote from assessment
 *   POST /functions/v1/money-flow/invoice      - Create invoice from accepted quote
 *   POST /functions/v1/money-flow/payment/intent - Create payment intent (FPX/Card)
 *   POST /functions/v1/money-flow/payment/confirm - Confirm payment (webhook)
 *   GET  /functions/v1/money-flow/lead/:id     - Get lead status (operator)
 *   GET  /functions/v1/money-flow/metrics      - Pipeline metrics (operator)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const BILLPLZ_API_KEY = Deno.env.get("BILLPLZ_API_KEY") || ""
const BILLPLZ_COLLECTION_ID = Deno.env.get("BILLPLZ_COLLECTION_ID") || ""
const HITPAY_API_KEY = Deno.env.get("HITPAY_API_KEY") || ""
const HITPAY_SALT = Deno.env.get("HITPAY_SALT") || ""
const APP_URL = Deno.env.get("APP_URL") || "https://agmx-v2-app.vercel.app"

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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

function successResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return null
  const token = authHeader.replace("Bearer ", "")
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}

async function getUserOrg(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", userId)
    .single()
  return profile
}

function generateRef(prefix: string) {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${ts}-${rand}`
}

// ---- Complexity Scoring (matches assessment.js) ----
function computeComplexityScore(input: AssessmentInput): number {
  let score = 0
  score += Math.min(input.members / 20, 30)           // 0-30 pts for members
  score += Math.min(input.candidates * 3, 15)         // 0-15 pts for candidates
  score += Math.min(input.motions * 2, 15)            // 0-15 pts for motions
  score += input.mode === "hybrid" ? 10 : input.mode === "online" ? 5 : 0  // mode
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

// ---- Plan Pricing (matches seed.json) ----
const PLAN_PRICING: Record<string, { oneoff: number; name: string }> = {
  essential_agm: { oneoff: 1500, name: "Essential AGM" },
  professional_agm: { oneoff: 3500, name: "Professional AGM" },
  enterprise_agm: { oneoff: 7500, name: "Enterprise AGM" },
  governance_os_essential: { oneoff: 0, name: "Governance OS Essential" }, // subscription
  governance_os_professional: { oneoff: 0, name: "Governance OS Professional" },
  governance_os_enterprise: { oneoff: 0, name: "Governance OS Enterprise" },
  governance_os_federation: { oneoff: 0, name: "Governance OS Federation" },
}

const TAX_RATE = 0.08 // SST 8%

// ---- Billplz Integration ----
async function createBillplzBill(invoiceId: string, amount: number, description: string, email: string, callbackUrl: string) {
  if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID) {
    throw new Error("Billplz not configured")
  }
  const body = {
    collection_id: BILLPLZ_COLLECTION_ID,
    description,
    email,
    amount: Math.round(amount * 100), // in cents
    callback_url: callbackUrl,
    redirect_url: `${APP_URL}/checkout.html?invoice=${invoiceId}&status=success`,
    reference_1_label: "Invoice",
    reference_1: invoiceId,
  }
  const resp = await fetch("https://www.billplz-sandbox.com/api/v3/bills", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(BILLPLZ_API_KEY + ":")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  const body = {
    api_key: HITPAY_API_KEY,
    amount: amount.toFixed(2),
    currency: "MYR",
    description,
    email,
    redirect_url: returnUrl,
    webhook_url: `${APP_URL}/functions/v1/money-flow/payment/confirm?gateway=hitpay`,
    reference_number: invoiceId,
  }
  const resp = await fetch("https://api.hitpay.io/v1/payment-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`HitPay error: ${err}`)
  }
  return resp.json()
}

// ---- Audit Logging ----
async function auditLog(orgId: string, actorId: string, action: string, entityType: string, entityId: string, payload: any) {
  const { data: lastEvent } = await supabase
    .from("audit_events")
    .select("hash")
    .eq("organization_id", orgId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .single()

  const prevHash = lastEvent?.hash || "0".repeat(64)
  const hashInput = prevHash + JSON.stringify(payload) + Date.now().toString()
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput))
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")

  await supabase.from("audit_events").insert({
    organization_id: orgId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    prev_hash: prevHash,
    hash,
  })
}

// ---- Handlers ----

async function handleAssessment(req: Request) {
  const input: AssessmentInput = await req.json()
  
  // Validate required fields
  if (!input.coopName || !input.contactName || !input.contactPhone) {
    return errorResponse("Missing required fields: coopName, contactName, contactPhone")
  }
  if (input.members < 1) {
    return errorResponse("Members must be at least 1")
  }

  const complexityScore = computeComplexityScore(input)
  const recommendedPlanCode = recommendPlan(complexityScore)

  // Get plan UUID
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("code", recommendedPlanCode)
    .single()

  // Create assessment lead
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
      recommended_plan_id: plan?.id,
      status: "lead",
      reference: generateRef("LD"),
      token: crypto.randomUUID(),
    })
    .select()
    .single()

  if (error) return errorResponse(error.message, 500)

  // Audit
  await auditLog(
    "00000000-0000-0000-0000-000000000000", // no org yet
    "00000000-0000-0000-0000-000000000000", // anonymous
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
  const user = await getAuthUser(req)
  if (!user) return errorResponse("Unauthorized", 401)
  
  const profile = await getUserOrg(user.id)
  if (!profile || !["admin", "secretary"].includes(profile.role)) {
    return errorResponse("Operator access required", 403)
  }

  const input: QuoteInput = await req.json()
  
  // Get assessment
  const { data: assessment, error: aErr } = await supabase
    .from("agm_assessments")
    .select("*")
    .eq("id", input.assessmentId)
    .single()
  if (aErr || !assessment) return errorResponse("Assessment not found", 404)

  // Get plan
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
      organization_id: profile.organization_id,
      assessment_id: input.assessmentId,
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

  // Quote items
  await supabase.from("quote_items").insert({
    quote_id: quote.id,
    plan_id: plan.id,
    description: plan.name,
    quantity: 1,
    unit_price: subtotal,
    line_total: subtotal,
  })

  // Update assessment status
  await supabase
    .from("agm_assessments")
    .update({ status: "quoted" })
    .eq("id", input.assessmentId)

  // Audit
  await auditLog(profile.organization_id, user.id, "quote.created", "quote", quote.id, {
    assessmentId: input.assessmentId,
    planCode: input.planCode,
    total,
  })

  return successResponse({
    quoteId: quote.id,
    number: quote.number,
    total,
    validUntil: quote.valid_until,
    checkoutUrl: `${APP_URL}/checkout.html?quote=${quote.id}`,
  }, 201)
}

async function handleInvoice(req: Request) {
  const user = await getAuthUser(req)
  if (!user) return errorResponse("Unauthorized", 401)
  
  const profile = await getUserOrg(user.id)
  if (!profile || !["admin", "secretary"].includes(profile.role)) {
    return errorResponse("Operator access required", 403)
  }

  const { quoteId } = await req.json()

  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("organization_id", profile.organization_id)
    .single()
  if (!quote) return errorResponse("Quote not found", 404)

  if (quote.status !== "accepted") {
    return errorResponse("Quote must be accepted first", 400)
  }

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 14) // Net 14
  const invoiceNumber = generateRef("INV")

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: profile.organization_id,
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

  // Update quote status
  await supabase.from("quotes").update({ status: "invoiced" }).eq("id", quoteId)

  // Audit
  await auditLog(profile.organization_id, user.id, "invoice.created", "invoice", invoice.id, {
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
  const user = await getAuthUser(req)
  if (!user) return errorResponse("Unauthorized", 401)

  const input: PaymentIntentInput = await req.json()

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", input.invoiceId)
    .single()
  if (!invoice) return errorResponse("Invoice not found", 404)

  if (invoice.status === "paid") {
    return errorResponse("Invoice already paid", 400)
  }

  const paymentRef = generateRef("PAY")
  const callbackUrl = input.callbackUrl || `${APP_URL}/functions/v1/money-flow/payment/confirm`
  const returnUrl = input.returnUrl || `${APP_URL}/checkout.html?invoice=${input.invoiceId}&status=success`

  let paymentUrl = ""
  let gatewayRef = ""

  if (input.method === "fpx") {
    const bill = await createBillplzBill(
      invoice.id,
      invoice.amount,
      `AGMX Invoice ${invoice.number}`,
      user.email || "",
      callbackUrl
    )
    paymentUrl = bill.url
    gatewayRef = bill.id
  } else if (input.method === "card") {
    const payment = await createHitPayPayment(
      invoice.id,
      invoice.amount,
      `AGMX Invoice ${invoice.number}`,
      user.email || "",
      returnUrl
    )
    paymentUrl = payment.redirect_url
    gatewayRef = payment.id
  } else {
    // Bank transfer - manual
    paymentUrl = `${APP_URL}/checkout.html?invoice=${input.invoiceId}&method=bank_transfer`
  }

  const { data: payment } = await supabase
    .from("payments")
    .insert({
      invoice_id: input.invoiceId,
      organization_id: invoice.organization_id,
      method: input.method,
      reference: paymentRef,
      amount: invoice.amount,
      status: "pending",
    })
    .select()
    .single()

  // Audit
  await auditLog(invoice.organization_id, user.id, "payment.intent_created", "payment", payment.id, {
    invoiceId: input.invoiceId,
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

async function handlePaymentConfirm(req: Request) {
  const url = new URL(req.url)
  const gateway = url.searchParams.get("gateway") || "billplz"
  const body = await req.json()

  let invoiceId = ""
  let gatewayRef = ""
  let status = "pending"
  let paidAt = new Date().toISOString()

  if (gateway === "billplz") {
    // Billplz callback: { id, paid, paid_at, x_signature }
    invoiceId = body.reference_1
    gatewayRef = body.id
    status = body.paid ? "succeeded" : "failed"
    paidAt = body.paid_at ? new Date(body.paid_at).toISOString() : new Date().toISOString()
    // TODO: Verify x_signature with BILLPLZ_API_KEY
  } else if (gateway === "hitpay") {
    // HitPay webhook: { reference_number, status, transaction_id }
    invoiceId = body.reference_number
    gatewayRef = body.transaction_id
    status = body.status === "completed" ? "succeeded" : "failed"
  }

  if (!invoiceId) return errorResponse("Missing invoice reference", 400)

  // Update payment
  const { data: payment } = await supabase
    .from("payments")
    .update({
      status,
      paid_at: status === "succeeded" ? paidAt : null,
      reference: gatewayRef,
    })
    .eq("invoice_id", invoiceId)
    .eq("reference", gatewayRef)
    .select()
    .single()

  // Update invoice
  if (status === "succeeded") {
    await supabase.from("invoices").update({ status: "paid", paid_at: paidAt }).eq("id", invoiceId)
    await supabase.from("agm_assessments")
      .update({ status: "won" })
      .eq("id", (await supabase.from("quotes").select("assessment_id").eq("id", (await supabase.from("invoices").select("quote_id").eq("id", invoiceId).single()).single()).single()).assessment_id)
  }

  // Audit
  if (payment) {
    await auditLog(payment.organization_id, "00000000-0000-0000-0000-000000000000", "payment.confirmed", "payment", payment.id, {
      gateway,
      gatewayRef,
      status,
      amount: payment.amount,
    })
  }

  return successResponse({ success: true, status })
}

async function handleLead(req: Request) {
  const user = await getAuthUser(req)
  if (!user) return errorResponse("Unauthorized", 401)
  
  const profile = await getUserOrg(user.id)
  if (!profile || !["admin", "secretary"].includes(profile.role)) {
    return errorResponse("Operator access required", 403)
  }

  const url = new URL(req.url)
  const id = url.pathname.split("/").pop()

  const { data: assessment } = await supabase
    .from("agm_assessments")
    .select(`
      *,
      quotes ( id, number, status, total, valid_until ),
      invoices ( id, number, status, amount, due_at, paid_at ),
      payments ( id, method, status, amount, paid_at )
    `)
    .eq("id", id)
    .single()

  if (!assessment) return errorResponse("Lead not found", 404)

  return successResponse(assessment)
}

async function handleMetrics(req: Request) {
  const user = await getAuthUser(req)
  if (!user) return errorResponse("Unauthorized", 401)
  
  const profile = await getUserOrg(user.id)
  if (!profile || !["admin", "secretary"].includes(profile.role)) {
    return errorResponse("Operator access required", 403)
  }

  const { data: assessments } = await supabase
    .from("agm_assessments")
    .select("status, complexity_score, created_at, recommended_plan_id")
    .order("created_at", { ascending: false })

  const { data: quotes } = await supabase
    .from("quotes")
    .select("status, total, created_at")
    .order("created_at", { ascending: false })

  const { data: invoices } = await supabase
    .from("invoices")
    .select("status, amount, issued_at, paid_at")
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

  const url = new URL(req.url)
  const path = url.pathname.replace("/functions/v1/money-flow", "")
  const method = req.method

  try {
    if (method === "POST" && path === "/assessment") {
      return await handleAssessment(req)
    }
    if (method === "POST" && path === "/quote") {
      return await handleQuote(req)
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
    if (method === "GET" && path.startsWith("/lead/")) {
      return await handleLead(req)
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