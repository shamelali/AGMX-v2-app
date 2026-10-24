# SPA Application Override

> **Page:** SPA Application (app.html)
> **Overrides:** MASTER.md

---

## App Shell Layout

```html
<div class="app">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-mark">AG</div>
      <div class="brand-text">
        <div class="b1">AGMX</div>
        <div class="b2">Governance OS</div>
      </div>
    </div>

    <nav class="nav-section" data-nav-group="governance">
      <h4 class="nav-section-title">Governance</h4>
      <ul class="nav-list">
        <li class="nav-item" data-route="dashboard">
          <span class="nav-icon">📊</span>
          <span>Dashboard</span>
          <span class="nav-badge">LIVE</span>
        </li>
        <li class="nav-item" data-route="members">
          <span class="nav-icon">👥</span>
          <span>Members</span>
          <span class="nav-badge">1,284</span>
        </li>
        <li class="nav-item" data-route="electoral-roll">
          <span class="nav-icon">📋</span>
          <span>Electoral Roll</span>
          <span class="nav-badge">1,162</span>
        </li>
        <li class="nav-item" data-route="nominations">
          <span class="nav-icon">🗳️</span>
          <span>Nominations</span>
          <span class="nav-badge">6</span>
        </li>
        <li class="nav-item" data-route="candidates">
          <span class="nav-icon">👤</span>
          <span>Candidates</span>
          <span class="nav-badge">8</span>
        </li>
        <li class="nav-item" data-route="notices">
          <span class="nav-icon">📢</span>
          <span>Notices</span>
          <span class="nav-badge">3</span>
        </li>
        <li class="nav-item" data-route="agm-pack">
          <span class="nav-icon">📦</span>
          <span>AGM Pack</span>
          <span class="nav-badge">6</span>
        </li>
        <li class="nav-item" data-route="registration">
          <span class="nav-icon">📋</span>
          <span>Registration</span>
          <span class="nav-badge">403</span>
        </li>
        <li class="nav-item" data-route="quorum">
          <span class="nav-icon">📊</span>
          <span>Quorum</span>
          <span class="nav-badge live">LIVE</span>
        </li>
        <li class="nav-item" data-route="agm-hall">
          <span class="nav-icon">🏛️</span>
          <span>AGM Hall</span>
          <span class="nav-badge live">LIVE</span>
        </li>
        <li class="nav-item" data-route="scanner">
          <span class="nav-icon">📱</span>
          <span>QR Scanner</span>
        </li>
        <li class="nav-item" data-route="voting">
          <span class="nav-icon">🗳️</span>
          <span>E-Voting</span>
          <span class="nav-badge">3</span>
        </li>
        <li class="nav-item" data-route="motions">
          <span class="nav-icon">📝</span>
          <span>Motions</span>
          <span class="nav-badge">5</span>
        </li>
      </ul>
    </nav>

    <nav class="nav-section" data-nav-group="tools">
      <h4 class="nav-section-title">Tools</h4>
      <ul class="nav-list">
        <li class="nav-item" data-route="wizard">
          <span class="nav-icon">✨</span>
          <span>AGM Wizard</span>
        </li>
        <li class="nav-item" data-route="compliance-calendar">
          <span class="nav-icon">📅</span>
          <span>Compliance Calendar</span>
          <span class="nav-badge">11/15</span>
        </li>
        <li class="nav-item" data-route="senior-member">
          <span class="nav-icon">🧓</span>
          <span>Senior Mode</span>
        </li>
      </ul>
    </nav>

    <nav class="nav-section" data-nav-group="ai">
      <h4 class="nav-section-title">AI Governance</h4>
      <ul class="nav-list">
        <li class="nav-item" data-route="copilot">
          <span class="nav-icon">🤖</span>
          <span>AI Copilot</span>
          <span class="nav-badge">6 agents</span>
        </li>
        <li class="nav-item" data-route="compliance">
          <span class="nav-icon">🛡️</span>
          <span>Compliance</span>
          <span class="nav-badge">98%</span>
        </li>
      </ul>
    </nav>

    <nav class="nav-section" data-nav-group="security">
      <h4 class="nav-section-title">Security & Audit</h4>
      <ul class="nav-list">
        <li class="nav-item" data-route="vault">
          <span class="nav-icon">🔐</span>
          <span>Evidence Vault</span>
        </li>
        <li class="nav-item" data-route="roadmap">
          <span class="nav-icon">🗺️</span>
          <span>Roadmap</span>
        </li>
        <li class="nav-item" data-route="settings">
          <span class="nav-icon">⚙️</span>
          <span>Settings</span>
        </li>
      </ul>
    </nav>

    <div class="sidebar-foot">
      <div class="plan-badge">Enterprise</div>
      <div>KOPEMAJU</div>
      <div style="margin-top: 4px; opacity: 0.7">ID: KPM-2024-00142</div>
    </div>
  </aside>

  <!-- Header -->
  <header class="header">
    <div class="h-left">
      <div>
        <div class="h-title" id="h-title">Dashboard</div>
        <div class="h-subtitle" id="h-subtitle">KOPEMAJU · Enterprise</div>
      </div>
      <div class="h-divider"></div>
      <div class="h-live-pill">
        <span class="h-live-dot"></span>
        AGM LIVE · 02:18:42
      </div>
    </div>
    <div class="h-right">
      <button class="h-icon-btn" id="ai-toggle" title="AI Copilot" aria-label="AI Copilot">
        <svg>...</svg>
      </button>
      <button class="h-icon-btn" id="notif-btn" title="Notifications" aria-label="Notifications">
        <svg>...</svg>
        <span class="notif-dot"></span>
      </button>
      <button class="h-icon-btn" id="theme-toggle" title="Toggle Theme" aria-label="Toggle Theme">
        <svg>...</svg>
      </button>
      <button class="h-icon-btn" id="senior-toggle" title="Senior Mode" aria-label="Senior Mode">
        <svg>...</svg>
      </button>
      <div class="h-user" id="profile-btn">
        <div class="h-avatar">JD</div>
        <div>
          <div class="u-name">John Doe</div>
          <div class="u-role">Secretary · Enterprise</div>
        </div>
        <svg class="chev-down">...</svg>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="main" id="main">
    <!-- Page content rendered here by router -->
  </main>

  <!-- AI Copilot Drawer -->
  <aside class="copilot-drawer" id="copilot-drawer">
    <div class="copilot-drawer-head">
      <div class="ai-avatar">
        <svg>...</svg>
      </div>
      <div>
        <div class="dh-name">AGMX AI Copilot</div>
        <div class="dh-sub">6 agents active · RAG + Audit Always</div>
      </div>
      <button class="h-icon-btn" id="drawer-close" aria-label="Close Copilot">
        <svg>...</svg>
      </button>
    </div>
    <div class="copilot-drawer-body">
      <div class="ai-alert">
        <div class="ai-alert-head">⚡ AI Chairman Alert</div>
        <div class="ai-alert-text">Quorum at 78% — 45 members needed for quorum</div>
        <div class="ai-alert-actions">
          <button class="btn btn-sm btn-primary">View Details</button>
          <button class="btn btn-sm btn-ghost">Dismiss</button>
        </div>
      </div>
      <div class="copilot-agent-list">
        <div class="copilot-agent active" data-agent="chairman">
          <div class="ca-icon c1">👑</div>
          <div class="ca-text">
            <div class="t1">AI Chairman</div>
            <div class="t2">Procedural reminders, time management</div>
          </div>
        </div>
        <div class="copilot-agent" data-agent="secretary">
          <div class="ca-icon c2">📝</div>
          <div class="ca-text">
            <div class="t1">AI Secretary</div>
            <div class="t2">Speech-to-text, auto-minutes</div>
          </div>
        </div>
        <div class="copilot-agent" data-agent="compliance">
          <div class="ca-icon c3">🛡️</div>
          <div class="ca-text">
            <div class="t1">AI Compliance</div>
            <div class="t2">Akta 1993, GP14, UUK checks</div>
          </div>
        </div>
        <div class="copilot-agent" data-agent="planner">
          <div class="ca-icon c4">📅</div>
          <div class="ca-text">
            <div class="t1">AI Planner</div>
            <div class="t2">Timeline, readiness, checklists</div>
          </div>
        </div>
        <div class="copilot-agent" data-agent="nomination">
          <div class="ca-icon c5">🗳️</div>
          <div class="ca-text">
            <div class="t1">AI Nomination</div>
            <div class="t2">Eligibility checks, doc validation</div>
          </div>
        </div>
        <div class="copilot-agent" data-agent="questions">
          <div class="ca-icon c6">❓</div>
          <div class="ca-text">
            <div class="t1">AI Questions</div>
            <div class="t2">Cluster duplicates, prioritize</div>
          </div>
        </div>
      </div>
      <div class="copilot-drawer-foot">
        <button class="btn btn-primary btn-block" id="open-full-copilot">
          <span>Open Full Copilot</span>
        </button>
      </div>
    </div>

    <!-- Notifications Panel -->
    <div class="notif-panel" id="notif-panel">
      <div class="notif-head">
        <h3>Notifications</h3>
        <button class="btn btn-ghost btn-sm" id="mark-all-read">Mark all read</button>
      </div>
      <div class="notif-list" id="notif-list">
        <!-- Dynamic -->
      </div>
    </div>

    <!-- Profile Menu -->
    <div class="profile-menu" id="profile-menu">
      <div class="profile-head">
        <div class="profile-avatar">JD</div>
        <div>
          <div class="u-name">John Doe</div>
          <div class="u-role">Secretary · Enterprise</div>
        </div>
      </div>
      <div class="profile-divider"></div>
      <nav class="profile-menu-list">
        <a href="#/profile" class="pml-item">
          <svg>...</svg>
          <span>Profile</span>
        </a>
        <a href="#/settings" class="pml-item">
          <svg>...</svg>
          <span>Settings</span>
        </a>
        <a href="#/billing" class="pml-item">
          <svg>...</svg>
          <span>Billing</span>
        </a>
        <div class="profile-divider"></div>
        <a href="#/audit" class="pml-item">
          <svg>...</svg>
          <span>Audit Log</span>
        </a>
        <div class="profile-divider"></div>
        <button class="pml-item danger" id="logout-btn">
          <svg>...</svg>
          <span>Sign Out</span>
        </button>
      </nav>
    </div>

    <!-- Search Overlay -->
    <div class="search-overlay" id="search-overlay">
      <div class="search-bar">
        <svg>...</svg>
        <input type="search" placeholder="Search AGMX... (⌘K)" autocomplete="off">
        <kbd>⌘K</kbd>
      </div>
      <div class="search-results" id="search-results">
        <div class="search-section">
          <h4>Navigation</h4>
          <div class="sri-list" id="sri-nav"></div>
        </div>
        <div class="search-section">
          <h4>Actions</h4>
          <div class="sri-list" id="sri-actions"></div>
        </div>
        <div class="search-section">
          <h4>Documents</h4>
          <div class="sri-list" id="sri-docs"></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

---

## SPA-Specific Styles

```css
/* App Shell */
.app {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  grid-template-rows: var(--header-h) 1fr;
  height: 100vh;
  grid-template-areas:
    "sidebar header"
    "sidebar main";
}

/* Sidebar */
.sidebar {
  grid-area: sidebar;
  background: linear-gradient(180deg, var(--c-primary-700) 0%, var(--c-primary) 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  position: relative;
  overflow-y: auto;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}

.brand-mark {
  width: 38px;
  height: 38px;
  background: var(--c-accent);
  color: var(--c-primary-700);
  font-weight: 800;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 16px;
  letter-spacing: 0.5px;
  box-shadow: 0 4px 12px rgba(212,160,23,0.4);
}

.brand-text { line-height: 1.15; }
.brand-text .b1 { font-weight: 800; font-size: 17px; letter-spacing: -0.2px; }
.brand-text .b2 { font-size: 11px; opacity: 0.7; letter-spacing: 1.5px; text-transform: uppercase; }

.nav-section { padding: 16px 12px 6px; }
.nav-section-title { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.55; padding: 0 10px 6px; }
.nav-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  color: rgba(255,255,255,0.78);
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.15s;
  position: relative;
}
.nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
.nav-item.active {
  background: rgba(255,255,255,0.15);
  color: #fff;
  font-weight: 600;
}
.nav-item.active::before {
  content: "";
  position: absolute;
  left: 0; top: 8px; bottom: 8px;
  width: 3px;
  background: var(--c-accent);
  border-radius: 0 3px 3px 0;
}
.nav-icon { width: 18px; height: 18px; flex-shrink: 0; }
.nav-badge {
  margin-left: auto;
  background: var(--c-accent);
  color: var(--c-primary-700);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
}
.nav-badge.live {
  background: var(--c-danger);
  color: #fff;
  animation: pulse 1.6s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

.sidebar-foot {
  margin-top: auto;
  padding: 14px 20px;
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  border-top: 1px solid rgba(255,255,255,0.1);
}
.plan-pill {
  display: inline-block;
  background: var(--c-accent);
  color: var(--c-primary-700);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

/* Header */
.header {
  grid-area: header;
  background: linear-gradient(180deg, var(--c-surface) 0%, var(--c-surface-2) 100%);
  border-bottom: 1px solid var(--c-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-h);
  padding: 0 var(--space-lg);
  position: sticky;
  top: 0;
  z-index: 100;
}

.h-left { display: flex; align-items: center; gap: 14px; flex: 1; }
.h-title { font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }
.h-subtitle { font-size: 12px; color: var(--c-text-3); }
.h-divider { width: 1px; height: 24px; background: var(--c-border); }
.h-live-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: var(--c-danger-100);
  color: var(--c-danger);
  border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.h-live-dot {
  width: 6px; height: 6px;
  background: var(--c-danger);
  border-radius: 50%;
  animation: pulse 1.6s infinite;
}

.h-right { display: flex; align-items: center; gap: 12px; }
.h-icon-btn {
  width: 36px; height: 36px;
  border-radius: 8px;
  display: grid; place-items: center;
  color: var(--c-text-2);
  transition: all 0.15s;
}
.h-icon-btn:hover { background: var(--c-bg); color: var(--c-primary); }

.notif-btn { position: relative; }
.notif-btn .dot {
  position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px;
  background: var(--c-danger);
  border-radius: 50%;
  animation: pulse 1.6s infinite;
}

.h-user {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 8px;
  cursor: pointer;
}
.h-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--c-primary), var(--c-accent));
  color: #fff; font-weight: 700;
  display: grid; place-items: center;
  font-size: 12px;
}
.u-name { font-weight: 600; font-size: 13px; }
.u-role { font-size: 11px; color: var(--c-text-3); }
.chev-down { width: 14px; height: 14px; color: var(--c-text-3); }

/* Main */
.main {
  grid-area: main;
  background: var(--c-bg);
  overflow: auto;
}

/* Copilot Drawer */
.copilot-drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 380px;
  background: linear-gradient(180deg, var(--c-primary-700) 0%, var(--c-primary) 100%);
  color: #fff;
  z-index: 200;
  transform: translateX(100%);
  transition: transform 0.3s ease;
  display: flex;
  flex-direction: column;
}
.copilot-drawer.open { transform: translateX(0); }

.copilot-drawer-head {
  display: flex; align-items: center; gap: 10px;
  padding: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.copilot-drawer-head .ai-avatar {
  width: 42px; height: 42px;
  border-radius: 10px;
  background: rgba(255,255,255,0.2);
  display: grid; place-items: center;
}
.copilot-drawer-head .dh-name { font-weight: 700; font-size: 15px; }
.copilot-drawer-head .dh-sub { font-size: 11px; opacity: 0.7; }

.copilot-drawer-body { flex: 1; padding: 16px; overflow-y: auto; }

.ai-alert {
  background: rgba(212,160,23,0.2);
  border: 1px solid var(--c-accent);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 16px;
}
.ai-alert-head { font-weight: 700; margin-bottom: 4px; }
.ai-alert-text { font-size: 13px; opacity: 0.9; }
.ai-alert-actions { display: flex; gap: 8px; margin-top: 8px; }

.copilot-drawer-body .space-y-3 { display: flex; flex-direction: column; gap: 12px; }
.copilot-agent {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  transition: all 0.15s;
}
.copilot-agent:hover { background: rgba(255,255,255,0.1); }
.copilot-agent.active { background: rgba(212,160,23,0.15); border-color: var(--c-accent); }
.ca-icon { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; font-size: 16px; flex-shrink: 0; }
.ca-icon.c1 { background: var(--c-warning-100); color: var(--c-warning); }
.ca-icon.c2 { background: var(--c-primary-100); color: var(--c-primary); }
.ca-icon.c3 { background: var(--c-danger-100); color: var(--c-danger); }
.ca-icon.c4 { background: var(--c-primary-100); color: var(--c-primary); }
.ca-icon.c5 { background: var(--c-accent-100); color: var(--c-accent-600); }
.ca-icon.c6 { background: var(--c-info-100); color: var(--c-info); }
.ca-text { flex: 1; min-width: 0; }
.ca-text .t1 { font-weight: 700; font-size: 13px; }
.ca-text .t2 { font-size: 11px; opacity: 0.7; margin-top: 2px; }

.copilot-drawer-foot { padding: 16px; border-top: 1px solid rgba(255,255,255,0.12); }

/* Notifications Panel */
.notif-panel {
  position: fixed; top: var(--header-h); right: 0; bottom: 0;
  width: 360px;
  background: var(--c-surface);
  border-left: 1px solid var(--c-border);
  z-index: 150;
  transform: translateX(100%);
  transition: transform 0.3s ease;
}
.notif-panel.open { transform: translateX(0); }
.notif-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--c-border); }
.notif-list { max-height: calc(100vh - 64px); overflow-y: auto; padding: 8px; }

/* Profile Menu */
.profile-menu { position: fixed; top: calc(var(--header-h) + 8px); right: 16px; z-index: 100; }
.profile-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; }
.profile-head .u-name { font-weight: 600; font-size: 13px; }
.profile-head .u-role { font-size: 11px; color: var(--c-text-3); }
.profile-divider { border-top: 1px solid var(--c-divider); margin: 8px 0; }
.pml-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 8px; font-size: 13px; color: var(--c-text); }
.pml-item:hover { background: var(--c-bg); }
.pml-item.danger { color: var(--c-danger); }
.pml-item svg { width: 16px; height: 16px; flex-shrink: 0; }

/* Search Overlay */
.search-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(15,23,42,0.8); backdrop-filter: blur(8px); display: flex; flex-direction: column; align-items: center; padding-top: 15vh; opacity: 0; visibility: hidden; transition: all 0.2s ease; }
.search-overlay.open { opacity: 1; visibility: visible; }
.search-bar { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 640px; padding: 16px 20px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px; box-shadow: var(--sh-pop); }
.search-bar svg { color: var(--c-text-3); flex-shrink: 0; }
.search-bar input { flex: 1; background: transparent; border: none; outline: none; font-size: 16px; color: var(--c-text); padding: 4px 0; }
.search-bar kbd { font-size: 11px; padding: 2px 6px; background: var(--c-bg); border-radius: 4px; color: var(--c-text-3); font-family: monospace; }
.search-results { margin-top: 16px; width: 100%; max-width: 640px; }
.sri-list { display: flex; flex-direction: column; gap: 4px; }
.sri-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; transition: background 0.15s; }
.sri-item:hover { background: var(--c-bg); }
.sri-icon { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: var(--c-primary-100); color: var(--c-primary); }
.sri-text { flex: 1; }
.sri-title { font-weight: 600; font-size: 13px; }
.sri-sub { font-size: 11.5px; color: var(--c-text-3); margin-top: 2px; }

/* Skip Link */
.skip-link { position: absolute; top: -100%; left: 50%; transform: translateX(-50%); padding: 12px 24px; background: var(--c-primary); color: white; border-radius: 8px; font-weight: 600; z-index: 1000; transition: top 0.2s; }
.skip-link:focus { top: 12px; }
