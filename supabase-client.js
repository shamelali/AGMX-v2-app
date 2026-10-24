/**
 * AGMX — Supabase Client (Browser)
 * Replaces pocketbase-client.js for Supabase-first architecture
 * 
 * Usage:
 *   import { supabase, auth, db } from './supabase-client.js'
 *   await auth.signInWithOtp({ email: 'user@coop.my' })
 *   const { data } = await db.from('members').select('*')
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Config loaded from /api/config.js
const CONFIG = window.AGMX_CONFIG || {}

// Create Supabase client
export const supabase = createClient(
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

// ---- Auth Helpers ----
export const auth = {
  // Email/Phone OTP
  async signInWithOtp({ email, phone }) {
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      phone,
      options: {
        shouldCreateUser: true,
        data: { app_name: CONFIG.appName },
      },
    })
    return { data, error }
  },

  // Google OAuth
  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${CONFIG.appUrl}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
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
        .eq('status', 'live')
        .order('scheduled_at', { ascending: false })
        .limit(1)
        .single()
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
    async runChecks(agmId, orgId) {
      const { data, error } = await supabase.rpc('run_compliance_checks', {
        p_agm_id: agmId,
        p_org_id: orgId,
      })
      return { data, error }
    },

    async getFindings(orgId) {
      const { data, error } = await supabase
        .from('compliance_findings')
        .select('*, check:compliance_checks(*, rule:compliance_rules(*))')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      return { data, error }
    },
  },

  // Knowledge/RAG
  knowledge: {
    async query(question, orgId) {
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/knowledge-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ question, organization_id: orgId }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },

    async ingest(documentId, orgId) {
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/knowledge-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ document_id: documentId, organization_id: orgId }),
      })
      if (!resp.ok) throw new Error(await resp.text())
      return resp.json()
    },
  },

  // Money Flow (Operator only)
  money: {
    async submitAssessment(assessment) {
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/money-flow/assessment`, {
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
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/money-flow/quote`, {
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
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/money-flow/invoice`, {
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
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/money-flow/payment/intent`, {
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
      const resp = await fetch(`${CONFIG.appUrl}/functions/v1/money-flow/metrics`, {
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
  
  isAuthenticated() {
    return supabase.auth.getSession().then(({ data: { session } }) => !!session)
  },
  
  getCurrentUser() {
    return auth.getUser()
  },
  
  // Data loading (for app-bootstrap.js compatibility)
  async loadDashboard() {
    const { user } = await auth.getUser()
    if (!user) throw new Error('Not authenticated')
    
    const { data: profile } = await profile.getCurrent()
    if (!profile) throw new Error('Profile not found')
    
    const orgId = profile.organization_id
    const [agm, members, agenda, motions] = await Promise.all([
      db.agm.getCurrent(orgId),
      profile.getMembers(orgId),
      db.agm.getAgenda(profile.agm_id),
      db.agm.getMotions(profile.agm_id),
    ])
    
    return {
      cooperative: profile.organization,
      currentUser: { ...profile, id: user.id, email: user.email },
      members: members.data || [],
      agm: agm.data,
      agenda: agenda.data || [],
      motions: motions.data || [],
      // ... other fields for compatibility
    }
  },
}

// Make available globally for legacy code
if (typeof window !== 'undefined') {
  window.AGMX_API = AGMX_API
  window.supabase = supabase
}

export default AGMX_API