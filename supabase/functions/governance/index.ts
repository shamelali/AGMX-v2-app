/**
 * AGMX Governance OS — Supabase Edge Function (Sprint 4)
 * Server-side AGM lifecycle: start/close, attendance + quorum, motions,
 * voting, resolutions, compliance, actions, documents, audit.
 *
 * The database RPCs (migrations/0007) enforce the governance invariants;
 * this function authenticates the caller, checks the tenant boundary,
 * and forwards. Members never get service-role power — vote casting is
 * scoped to their own linked member row.
 *
 * Endpoints (all JSON):
 *   GET  /agm/current                - live/planned AGM with agenda + settings
 *   GET  /agm/:id/roster             - members + attendance + quorum snapshot
 *   GET  /agm/:id/motions            - motions with proposer/seconder names
 *   GET  /agm/:id/resolutions        - recorded resolutions
 *   GET  /agm/:id/audit              - audit chain for the AGM's org
 *   GET  /agm/:id/compliance         - latest checks + open findings
 *   GET  /actions                    - follow-up actions for the org
 *   GET  /documents                  - evidence vault registrations for the org
 *   POST /agm                        - create an AGM (+ settings row)
 *   POST /agm/start                  - {agmId}
 *   POST /agm/close                  - {agmId}
 *   POST /attendance                 - {agmId, memberId?, method} (self check-in allowed)
 *   POST /motion                     - {agmId, title, type, proposerId?, seconderId?}
 *   POST /motion/open-voting         - {motionId}
 *   POST /vote                       - {motionId, choice} (voter bound to session)
 *   POST /resolution                 - {motionId}
 *   POST /action                     - {title, picId?, dueDate?, agmId?, resolutionId?}
 *   POST /compliance/run             - {agmId}
 *   POST /document                   - {agmId?, category, filename, mime, sizeBytes?, storagePath, sha256?}
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const ZERO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function ok(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

/* Auth: require a Supabase session and resolve the caller's org+role. */
async function authContext(req: Request) {
  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace("Bearer ", "")
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, full_name")
    .eq("id", user.id)
    .single()
  if (!profile) return null
  const role = String(profile.role || "").toLowerCase()
  const isOperator = role === "admin" || role === "secretary" || role.includes("administrator")
  return { user, profile, isOperator }
}

function rpcResult(data: any) {
  if (data && typeof data === "object" && "error" in data) {
    return err(String(data.error), 400)
  }
  return ok(data)
}

/* ---- Handlers ---- */

async function handleAgmCurrent(ctx: any) {
  const { data: agm, error } = await supabase
    .from("agms")
    .select("*, settings:agm_settings(*)")
    .eq("organization_id", ctx.profile.organization_id)
    .in("status", ["planned", "live", "closed", "minuted"])
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return err(error.message, 500)
  if (!agm) return ok({ agm: null, agenda: [], motions: [], resolutions: [] })

  const { data: agenda } = await supabase
    .from("agenda_items")
    .select("*")
    .eq("agm_id", agm.id)
    .order("sort_order")

  const { data: motions } = await supabase
    .from("motions")
    .select("*, proposer:members!motions_proposer_id_fkey(id, name, member_no), seconder:members!motions_seconder_id_fkey(id, name, member_no)")
    .eq("agm_id", agm.id)
    .order("created_at")

  const { data: resolutions } = await supabase
    .from("resolutions")
    .select("*")
    .eq("agm_id", agm.id)
    .order("minuted_at", { ascending: false })

  return ok({ agm, agenda: agenda || [], motions: motions || [], resolutions: resolutions || [] })
}

/* Sub-resource handlers share the /agm/:id/<what> shape. The request URL
   still carries the /functions/v1/governance prefix, so the id must come
   from the normalized path — never from a fixed segment index. */
function agmIdFromPath(path: string): string | null {
  const m = path.match(/^\/agm\/([^/]+)\/(?:roster|motions|resolutions|audit|compliance)$/)
  return m ? decodeURIComponent(m[1]) : null
}

async function loadMotionOrg(motionId: string, ctx: any) {
  const { data: motion } = await supabase.from("motions").select("organization_id").eq("id", motionId).single()
  if (!motion || motion.organization_id !== ctx.profile.organization_id) return null
  return motion
}

async function loadAgmOrg(agmId: string, ctx: any) {
  const { data: agm } = await supabase.from("agms").select("organization_id").eq("id", agmId).single()
  if (!agm || agm.organization_id !== ctx.profile.organization_id) return null
  return agm
}

async function handleRoster(agmId: string, ctx: any) {
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data: members } = await supabase
    .from("members")
    .select("id, member_no, name, status, eligible, shares")
    .eq("organization_id", ctx.profile.organization_id)
    .order("member_no")

  const { data: attendance } = await supabase
    .from("attendance")
    .select("member_id, check_in_at, method")
    .eq("agm_id", agmId)

  const { data: quorum } = await supabase
    .from("quorum_snapshots")
    .select("*")
    .eq("agm_id", agmId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return ok({ members: members || [], attendance: attendance || [], quorum: quorum || null })
}

async function handleMotionsList(agmId: string, ctx: any) {
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data: motions } = await supabase
    .from("motions")
    .select("*, proposer:members!motions_proposer_id_fkey(id, name, member_no), seconder:members!motions_seconder_id_fkey(id, name, member_no)")
    .eq("agm_id", agmId)
    .order("created_at")
  return ok({ motions: motions || [] })
}

async function handleResolutionsList(agmId: string, ctx: any) {
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data: resolutions } = await supabase
    .from("resolutions")
    .select("*")
    .eq("agm_id", agmId)
    .order("minuted_at", { ascending: false })
  return ok({ resolutions: resolutions || [] })
}

async function handleAuditList(agmId: string, ctx: any) {
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data: events } = await supabase
    .from("audit_events")
    .select("*")
    .eq("organization_id", agm.organization_id)
    .order("occurred_at", { ascending: false })
    .limit(200)
  return ok({ events: events || [] })
}

async function handleComplianceList(agmId: string, ctx: any) {
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data: checks } = await supabase
    .from("compliance_checks")
    .select("*, rule:compliance_rules(*)")
    .eq("agm_id", agmId)
    .order("checked_at", { ascending: false })

  // keep only the latest check per rule
  const latest = new Map<string, any>()
  for (const c of checks || []) {
    if (!latest.has(c.rule_id)) latest.set(c.rule_id, c)
  }

  const { data: findings } = await supabase
    .from("compliance_findings")
    .select("*")
    .eq("organization_id", agm.organization_id)
    .eq("status", "terbuka")
    .order("severity", { ascending: false })

  return ok({ checks: Array.from(latest.values()), findings: findings || [] })
}

async function handleDocuments(ctx: any) {
  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("organization_id", ctx.profile.organization_id)
    .order("created_at", { ascending: false })
    .limit(200)
  return ok({ documents: documents || [] })
}

async function handleActions(ctx: any) {
  const { data: actions } = await supabase
    .from("actions")
    .select("*, pic:members(id, name, member_no)")
    .eq("organization_id", ctx.profile.organization_id)
    .order("created_at", { ascending: false })
  return ok({ actions: actions || [] })
}

async function handleAgmCreate(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const input = await req.json()
  if (!input.title || !input.edition || !input.scheduledAt) {
    return err("Missing title, edition or scheduledAt")
  }

  const { data: agm, error } = await supabase
    .from("agms")
    .insert({
      organization_id: ctx.profile.organization_id,
      title: input.title,
      edition: Number(input.edition),
      fiscal_year: input.fiscalYear || null,
      scheduled_at: new Date(input.scheduledAt).toISOString(),
      venue: input.venue || null,
      mode: input.mode || "hybrid",
      status: "planned",
      quorum_pct: Number(input.quorumPct ?? 25),
      notice_days: Number(input.noticeDays ?? 21),
    })
    .select("*, settings:agm_settings(*)")
    .single()
  if (error) return err(error.message, 500)

  await supabase.from("agm_settings").insert({
    agm_id: agm.id,
    organization_id: ctx.profile.organization_id,
    allow_proxy: input.allowProxy ?? true,
    allow_online: input.allowOnline ?? true,
    min_seconder: input.minSeconder ?? 1,
  })

  // auto-seed the standard Malaysian cooperative AGM agenda
  const agenda = [
    { code: "AG-01", title: "Pengerusian & Ucapan Alu-aluan", type: "opening", duration_min: 10, sort_order: 1 },
    { code: "AG-02", title: "Pengesahan Kuorum & Notis Mesyuarat", type: "compliance", duration_min: 5, sort_order: 2 },
    { code: "AG-03", title: "Pengesahan Minit AGM Lepasan", type: "resolution", duration_min: 10, sort_order: 3 },
    { code: "AG-04", title: "Pembentangan Penyata Kewangan", type: "financial", duration_min: 25, sort_order: 4 },
    { code: "AG-05", title: "Laporan Tahunan & Pencapaian", type: "report", duration_min: 20, sort_order: 5 },
    { code: "AG-06", title: "Pembahagian Dividen & Lebih Surplus", type: "resolution", duration_min: 30, sort_order: 6 },
    { code: "AG-07", title: "Pilihan Raya Lembaga Pengarah", type: "election", duration_min: 45, sort_order: 7 },
    { code: "AG-08", title: "Usul-Usul Ahli", type: "motions", duration_min: 30, sort_order: 8 },
    { code: "AG-09", title: "Hal-Hal Lain & Penutup", type: "closing", duration_min: 10, sort_order: 9 },
  ]
  if (input.seedAgenda !== false) {
    await supabase.from("agenda_items").insert(
      agenda.map((a) => ({ ...a, agm_id: agm.id, organization_id: ctx.profile.organization_id }))
    )
  }

  return ok({ agm }, 201)
}

async function handleAgmStart(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { agmId } = await req.json()
  if (!agmId) return err("Missing agmId")
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data, error } = await supabase.rpc("start_agm", { p_agm_id: agmId })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleAgmClose(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { agmId } = await req.json()
  if (!agmId) return err("Missing agmId")
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data, error } = await supabase.rpc("close_agm", { p_agm_id: agmId })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleAttendance(req: Request, ctx: any) {
  const { agmId, memberId, method } = await req.json()
  if (!agmId) return err("Missing agmId")

  let targetMemberId = memberId || null
  if (!ctx.isOperator) {
    /* A non-operator may only check themselves in — resolve their linked
       member row and ignore any memberId sent in the body. */
    const { data: link } = await supabase
      .from("organization_members")
      .select("member_id")
      .eq("user_id", ctx.user.id)
      .eq("organization_id", ctx.profile.organization_id)
      .maybeSingle()
    if (!link?.member_id) return err("No member record linked to your account", 403)
    targetMemberId = link.member_id
  }
  if (!targetMemberId) return err("Missing memberId")

  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data, error } = await supabase.rpc("record_attendance", {
    p_agm_id: agmId,
    p_member_id: targetMemberId,
    p_method: method || "digital",
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleMotionCreate(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { agmId, title, type, proposerId, seconderId } = await req.json()
  if (!agmId || !title) return err("Missing agmId or title")

  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data, error } = await supabase.rpc("create_motion", {
    p_agm_id: agmId,
    p_title: title,
    p_type: type || "biasa",
    p_proposer_id: proposerId || null,
    p_seconder_id: seconderId || null,
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleMotionOpenVoting(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { motionId } = await req.json()
  if (!motionId) return err("Missing motionId")
  const motion = await loadMotionOrg(motionId, ctx)
  if (!motion) return err("Motion not found", 404)

  const { data, error } = await supabase.rpc("open_motion_voting", { p_motion_id: motionId })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleVote(req: Request, ctx: any) {
  const { motionId, choice } = await req.json()
  if (!motionId || !choice) return err("Missing motionId or choice")
  if (!["ya", "tidak", "kecuali"].includes(choice)) return err("Choice must be ya, tidak or kecuali")

  /* The voter is always the session's linked member — never the body. */
  const { data: link } = await supabase
    .from("organization_members")
    .select("member_id")
    .eq("user_id", ctx.user.id)
    .eq("organization_id", ctx.profile.organization_id)
    .maybeSingle()
  if (!link?.member_id) return err("No member record linked to your account", 403)

  const motion = await loadMotionOrg(motionId, ctx)
  if (!motion) return err("Motion not found", 404)

  const { data, error } = await supabase.rpc("cast_vote", {
    p_motion_id: motionId,
    p_voter_id: link.member_id,
    p_choice: choice,
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleResolution(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { motionId } = await req.json()
  if (!motionId) return err("Missing motionId")
  const motion = await loadMotionOrg(motionId, ctx)
  if (!motion) return err("Motion not found", 404)

  const { data, error } = await supabase.rpc("record_resolution", { p_motion_id: motionId })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleActionCreate(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { title, picId, dueDate, agmId, resolutionId } = await req.json()
  if (!title) return err("Missing title")

  const { data, error } = await supabase.rpc("create_action", {
    p_org: ctx.profile.organization_id,
    p_title: title,
    p_pic_id: picId || null,
    p_due_date: dueDate || null,
    p_agm_id: agmId || null,
    p_resolution_id: resolutionId || null,
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleComplianceRun(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { agmId } = await req.json()
  if (!agmId) return err("Missing agmId")
  const agm = await loadAgmOrg(agmId, ctx)
  if (!agm) return err("AGM not found", 404)

  const { data, error } = await supabase.rpc("run_compliance_checks", {
    p_org: ctx.profile.organization_id,
    p_agm_id: agmId,
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

async function handleDocumentCreate(req: Request, ctx: any) {
  if (!ctx.isOperator) return err("Operator access required", 403)
  const { agmId, category, filename, mime, sizeBytes, storagePath, sha256 } = await req.json()
  if (!category || !filename || !storagePath) return err("Missing category, filename or storagePath")

  if (agmId) {
    const { data: agm } = await supabase.from("agms").select("organization_id").eq("id", agmId).single()
    if (!agm || agm.organization_id !== ctx.profile.organization_id) return err("AGM not found", 404)
  }

  const { data, error } = await supabase.rpc("register_document", {
    p_org: ctx.profile.organization_id,
    p_agm_id: agmId || null,
    p_category: category,
    p_filename: filename,
    p_mime: mime || "application/octet-stream",
    p_size_bytes: sizeBytes ?? null,
    p_storage_path: storagePath,
    p_sha256: sha256 || null,
  })
  if (error) return err(error.message, 500)
  return rpcResult(data)
}

/* ---- Router ---- */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const ctx = await authContext(req)
  if (!ctx) return err("Unauthorized", 401)

  const url = new URL(req.url)
  let path = url.pathname.replace(/^\/functions\/v1\/governance/, "")
  if (path.startsWith("/governance")) path = path.slice("/governance".length) || "/"
  if (!path.startsWith("/")) path = "/" + path
  const method = req.method

  try {
    if (method === "GET" && path === "/agm/current") return await handleAgmCurrent(ctx)
    const subAgmId = agmIdFromPath(path)
    if (method === "GET" && subAgmId) {
      if (path.endsWith("/roster")) return await handleRoster(subAgmId, ctx)
      if (path.endsWith("/motions")) return await handleMotionsList(subAgmId, ctx)
      if (path.endsWith("/resolutions")) return await handleResolutionsList(subAgmId, ctx)
      if (path.endsWith("/audit")) return await handleAuditList(subAgmId, ctx)
      if (path.endsWith("/compliance")) return await handleComplianceList(subAgmId, ctx)
    }
    if (method === "GET" && path === "/actions") return await handleActions(ctx)
    if (method === "GET" && path === "/documents") return await handleDocuments(ctx)

    if (method === "POST" && path === "/agm") return await handleAgmCreate(req, ctx)
    if (method === "POST" && path === "/agm/start") return await handleAgmStart(req, ctx)
    if (method === "POST" && path === "/agm/close") return await handleAgmClose(req, ctx)
    if (method === "POST" && path === "/attendance") return await handleAttendance(req, ctx)
    if (method === "POST" && path === "/motion") return await handleMotionCreate(req, ctx)
    if (method === "POST" && path === "/motion/open-voting") return await handleMotionOpenVoting(req, ctx)
    if (method === "POST" && path === "/vote") return await handleVote(req, ctx)
    if (method === "POST" && path === "/resolution") return await handleResolution(req, ctx)
    if (method === "POST" && path === "/action") return await handleActionCreate(req, ctx)
    if (method === "POST" && path === "/compliance/run") return await handleComplianceRun(req, ctx)
    if (method === "POST" && path === "/document") return await handleDocumentCreate(req, ctx)

    return err("Not found", 404)
  } catch (e) {
    console.error("Governance error:", e)
    return err(e instanceof Error ? e.message : "Internal error", 500)
  }
})
