/**
 * AGMX — Supabase Client (Browser)
 * Replaces pocketbase-client.js for Supabase-first architecture
 * 
 * Usage:
 *   import { supabase, auth, db } from './supabase-client.js'
 *   await auth.signInWithEmail('user@coop.my', password)
 *   const { data } = await db.from('members').select('*')
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Config loaded from /config.js (served by api/config.js in deploys)
const CONFIG = window.AGMX_CONFIG || {}

const missingKeys = ["supabaseUrl", "supabaseAnonKey"].filter((k) => !CONFIG[k])
export const configProblem = missingKeys.length
  ? `Supabase is not configured — set ${missingKeys.join(" and ")} in config.js (see config.example.js)`
  : null

// An unconfigured client used to make createClient throw here, which aborted
// the whole module and left window.AGMX_API undefined. Callers then failed
// with "Cannot read properties of undefined (reading 'loginWithGoogle')"
// instead of being told what is missing.
function unconfiguredProxy() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(configProblem)
      },
    }
  )
}

// Create Supabase client
export const supabase = configProblem
  ? unconfiguredProxy()
  : createClient(
      CONFIG.supabaseUrl,
      CONFIG.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        realtime: CONFIG.realtimeEnabled ? { params: { eventsPerSecond: 10 } } : false,
      }
    )

// PASSWORD_RECOVERY is the only signal that the current session arrived through
// a reset link (user.recovered_at stays set afterwards). The listener has to be
// registered at import time, before detectSessionInUrl settles, or the event is
// missed and the caller can no longer tell recovery apart from a normal sign-in.
let passwordRecovery = false
if (!configProblem) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') passwordRecovery = true
  })
}

// ---- Auth Helpers ----
export const auth = {
  // Email + password
  async signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  },

  // Password reset link, emailed to an existing account
  async requestPasswordReset(email) {
    const baseUrl = CONFIG.appUrl || (typeof window !== 'undefined' ? window.location.origin : '')
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/auth/callback`,
    })
    return { data, error }
  },

  // New password while a recovery session is active
  async updatePassword(password) {
    const { data, error } = await supabase.auth.updateUser({ password })
    return { data, error }
  },

  // Google OAuth
  async signInWithGoogle() {
    const baseUrl = CONFIG.appUrl || (typeof window !== 'undefined' ? window.location.origin : '')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${baseUrl}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) throw error
    // The redirect is the normal outcome; a blocked navigation returns here.
    if (data?.url) window.location.assign(data.url)
    return { data, error }
  },

  // Get current user
  async getUser() {
    const { data: { user }, error } = await supabase.auth.getUser()
    return { user, error }
  },

  // Get session
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession()
    return { session, error }
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut()
    return { error }
  },

  // Listen to auth changes
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback)
  },
}

// ---- Profile Helpers ----
export const profile = {
  // Get current user's profile (includes org_id, role)
  async getCurrent() {
    const { user } = await auth.getUser()
    if (!user) return { data: null, error: new Error('Not authenticated') }

    const { data, error } = await supabase
      .from('profiles')
      .select('*, organization:organizations(*)')
      .eq('id', user.id)
      .single()
    return { data, error }
  },

  // Get organization members
  async getMembers(orgId) {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('organization_id', orgId)
      .order('member_no')
    return { data, error }
  },
}

// ---- Database Helpers (RLS-aware) ----
export const db = {
  // Generic query builder
  from(table) {
    return supabase.from(table)
  },

  // AGM-specific queries
  agm: {
    async getCurrent(orgId) {
      const { data, error } = await supabase
        .from('agms')
        .select('*, settings:agm_settings(*)')
        .eq('organization_id', orgId)
        .in('status', ['planned', 'live', 'closed', 'minuted'])
        .order('scheduled_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { data, error }
    },

    async getAgenda(agmId) {
      const { data, error } = await supabase
        .from('agenda_items')
        .select('*')
        .eq('agm_id', agmId)
        .order('sort_order')
      return { data, error }
    },

    async getMotions(agmId) {
      const { data, error } = await supabase
        .from('motions')
        .select('*, proposer:members!proposer_id(*), seconder:members!seconder_id(*)')
        .eq('agm_id', agmId)
        .order('created_at')
      return { data, error }
    },
  },

  // Voting
  vote: {
    async cast(voteData) {
      // voteData: { motion_id, voter_id, choice }
      const { data, error } = await supabase
        .from('votes')
        .insert(voteData)
        .select()
        .single()
      return { data, error }
    },

    async getTally(motionId) {
      const { data, error } = await supabase
        .from('votes')
        .select('choice')
        .eq('motion_id', motionId)
      if (error) return { data: null, error }
      
      const tally = { ya: 0, tidak: 0, kecuali: 0 }
      data?.forEach(v => tally[v.choice]++)
      return { data: tally, error: null }
    },
  },

  // Compliance
  compliance: {
    // The rules engine is pocketbase-client.js:853, not an RPC — no
    // supabase/*.sql ever defined run_compliance_checks, so the call that
    // used to live here failed with PGRST202 for every operator.

    async getFindings(orgId) {
      const { data, error } = await supabase
        .from('compliance_findings')
        .select('*, check:compliance_checks(*, rule:compliance_rules(*))')
        .eq('organization_id', orgId)
        // compliance_findings has no created_at column (migrations/0001_schema.sql:419)
        .order('severity', { ascending: false })
      return { data, error }
    },
  },

  // Knowledge/RAG
  knowledge: {
    async query(question) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/knowledge-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        // organization_id is intentionally omitted — the function derives the
        // tenant from the bearer token.
        body: JSON.stringify({ question }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async ingest(documentId) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/knowledge-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        // organization_id is intentionally omitted — the function derives the
        // tenant from the bearer token.
        body: JSON.stringify({ document_id: documentId }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },
  },

  // Governance OS (Sprint 4)
  // Every mutation goes through the governance Edge Function: the RPCs behind
  // it enforce quorum maths, voting windows, ballot secrecy and the audit
  // chain, and the voter's member row is bound to the session — never to a
  // value in the request body.
  governance: (() => {
    async function call(path, body) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/governance${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.supabaseAnonKey,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(payload.error || `Governance request failed (${resp.status})`)
      return payload
    }

    return {
      current: () => call('/agm/current'),
      roster: (agmId) => call(`/agm/${agmId}/roster`),
      motions: (agmId) => call(`/agm/${agmId}/motions`),
      resolutions: (agmId) => call(`/agm/${agmId}/resolutions`),
      compliance: (agmId) => call(`/agm/${agmId}/compliance`),
      audit: (agmId) => call(`/agm/${agmId}/audit`),
      actions: () => call('/actions'),
      documents: () => call('/documents'),
      createAgm: (input) => call('/agm', input),
      startAgm: (agmId) => call('/agm/start', { agmId }),
      closeAgm: (agmId) => call('/agm/close', { agmId }),
      checkIn: (agmId, memberId, method) => call('/attendance', { agmId, memberId: memberId || null, method: method || 'digital' }),
      createMotion: (input) => call('/motion', input),
      openVoting: (motionId) => call('/motion/open-voting', { motionId }),
      vote: (motionId, choice) => call('/vote', { motionId, choice }),
      recordResolution: (motionId) => call('/resolution', { motionId }),
      createAction: (input) => call('/action', input),
      runCompliance: (agmId) => call('/compliance/run', { agmId }),
      registerDocument: (input) => call('/document', input),
    }
  })(),

  // Money Flow (Operator only)
  money: {
    async submitAssessment(assessment) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/money-flow/assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify(assessment),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async createQuote(assessmentId, planCode) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/money-flow/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ assessmentId, planCode }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async createInvoice(quoteId) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/money-flow/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ quoteId }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async createPaymentIntent(invoiceId, method) {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/money-flow/payment/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ invoiceId, method }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async getLeads() {
      const resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/money-flow/metrics`, {
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },
  },
}

// ---- Realtime Subscriptions ----
export const realtime = {
  subscribeToVotes(agmId, callback) {
    return supabase
      .channel(`votes:${agmId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'votes',
        filter: `agm_id=eq.${agmId}`,
      }, callback)
      .subscribe()
  },

  subscribeToQuorum(agmId, callback) {
    return supabase
      .channel(`quorum:${agmId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'quorum_snapshots',
        filter: `agm_id=eq.${agmId}`,
      }, callback)
      .subscribe()
  },

  subscribeToAttendance(agmId, callback) {
    return supabase
      .channel(`attendance:${agmId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'attendance',
        filter: `agm_id=eq.${agmId}`,
      }, callback)
      .subscribe()
  },

  unsubscribe(channel) {
    supabase.removeChannel(channel)
  },
}

// ---- Export default AGMX_API compatible interface ----
export const AGMX_API = {
  // Config
  config: CONFIG,
  
  // Auth
  async init() {
    const { session } = await auth.getSession()
    return !!session
  },
  
  async loginWithGoogle() {
    return auth.signInWithGoogle()
  },
  
  async logout() {
    return auth.signOut()
  },

  // Email + password (used by the login.js form)
  async loginWithEmail(email, password) {
    return auth.signInWithEmail(email, password)
  },

  async requestPasswordReset(email) {
    return auth.requestPasswordReset(email)
  },

  async updatePassword(password) {
    return auth.updatePassword(password)
  },

  // True when this page load came back from a password reset link.
  isPasswordRecovery() {
    return passwordRecovery
  },

  isAuthenticated() {
    return supabase.auth.getSession().then(({ data: { session } }) => !!session)
  },

  // A session can end while the workspace is still on screen — sign-out in
  // another tab, a revoked token, an expired lockout. app-bootstrap.js has to
  // be told, or a shared meeting-room browser keeps a rendered AGM open after
  // the identity behind it is gone.
  onAuthStateChange(callback) {
    if (configProblem) return null
    return supabase.auth.onAuthStateChange((event, session) => callback(event, session))
  },
  
  getCurrentUser() {
    return auth.getUser()
  },
  
  // Data loading (for app-bootstrap.js compatibility)
  async loadDashboard() {
    const { user } = await auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: row, error } = await profile.getCurrent()
    if (error || !row) throw new Error('Profile not found')

    const orgId = row.organization_id
    const [{ data: members }, { data: agm }] = await Promise.all([
      profile.getMembers(orgId),
      db.agm.getCurrent(orgId),
    ])

    const [agenda, motions, quorum] = await Promise.all([
      agm ? db.agm.getAgenda(agm.id) : { data: [] },
      agm ? db.agm.getMotions(agm.id) : { data: [] },
      agm
        ? supabase.from('quorum_snapshots').select('*').eq('agm_id', agm.id)
            .order('captured_at', { ascending: false }).limit(1).maybeSingle()
        : { data: null },
    ])

    const org = row.organization || {}
    return {
      cooperative: {
        id: orgId,
        pbId: orgId,
        name: org.name,
        shortName: org.name,
        registrationNo: org.registration_no,
        state: org.state,
        zone: org.zone,
        plan: org.plan,
        quorumPct: agm ? Number(agm.quorum_pct) : null,
        members: (members || []).length,
      },
      currentUser: { id: user.id, email: user.email, name: row.full_name, role: row.role },
      members: members || [],
      agm: agm
        ? {
            id: agm.id,
            pbId: agm.id,
            title: agm.title,
            edition: agm.edition,
            status: agm.status,
            date: agm.scheduled_at,
            venue: agm.venue,
            mode: agm.mode,
            quorumPct: Number(agm.quorum_pct),
            quorumPresent: quorum.data ? Number(quorum.data.present) : 0,
            totalMembers: quorum.data ? Number(quorum.data.total_members) : (members || []).length,
          }
        : null,
      agenda: agenda.data || [],
      motions: motions.data || [],
    }
  },

  // Governance OS (Sprint 4) — consumed by governance-ui.js
  governance: db.governance,
}

// Make available globally for legacy code
if (typeof window !== 'undefined') {
  window.AGMX_API = AGMX_API
  window.supabase = supabase
}

export default AGMX_API