# Dashboard Page Override

> **Page:** Dashboard (app.html#/dashboard)
> **Overrides:** MASTER.md

---

## Layout Structure

```html
<div class="dashboard-layout">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">AGMX</div>
      <span class="sidebar-badge">Enterprise</span>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section">
        <h4 class="nav-section-title">Governance</h4>
        <nav class="nav-list">
          <a href="#/dashboard" class="nav-item active">
            <svg class="nav-icon">...</svg>
            <span>Dashboard</span>
            <span class="badge live">LIVE</span>
          </a>
          <a href="#/members" class="nav-item">
            <span>Members</span>
            <span class="badge">1,284</span>
          </a>
          <a href="#/agm" class="nav-item">
            <span>AGM Sessions</span>
            <span class="badge live">LIVE</span>
          </a>
          <a href="#/motions" class="nav-item">
            <span>Motions</span>
            <span class="badge">12</span>
          </a>
        </nav>
      </div>
      <div class="nav-section">
        <h4 class="nav-section-title">AI Governance</h4>
        <nav class="nav-list">
          <a href="#/copilot" class="nav-item">
            <span>AI Copilot</span>
            <span class="badge">6 agents</span>
          </a>
          <a href="#/compliance" class="nav-item">
            <span>Compliance</span>
            <span class="badge">98%</span>
          </a>
        </nav>
      </div>
    </nav>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <!-- Top Bar -->
    <header class="top-bar">
      <div class="top-bar-left">
        <h1>Dashboard</h1>
        <p class="subtitle">AGMX Enterprise · KOPEMAJU</p>
      </div>
      <div class="top-bar-right">
        <div class="status-indicator live">
          <span class="pulse"></span>
          <span>LIVE</span>
        </div>
        <button class="icon-btn" aria-label="Notifications">🔔</button>
        <button class="icon-btn" aria-label="Theme">🌓</button>
        <div class="user-menu">
          <div class="avatar">JD</div>
          <span>John Doe</span>
        </div>
      </div>
    </header>

    <!-- KPI Cards -->
    <section class="kpi-grid">
      <article class="kpi-card">
        <div class="kpi-icon primary">👥</div>
        <div class="kpi-content">
          <span class="kpi-label">Active Members</span>
          <span class="kpi-value">1,284</span>
          <span class="kpi-trend positive">+12% vs last month</span>
        </div>
      </article>
      <article class="kpi-card">
        <div class="kpi-icon warning">📊</div>
        <div class="kpi-content">
          <span class="kpi-label">Quorum Status</span>
          <span class="kpi-value">78%</span>
          <span class="kpi-trend">Target: 75%</span>
        </div>
      </article>
      <article class="kpi-card">
        <div class="kpi-icon success">🗳️</div>
        <div class="kpi-content">
          <span class="kpi-label">Active Motions</span>
          <span class="kpi-value">3</span>
          <span class="kpi-trend">2 pending vote</span>
        </div>
      </article>
      <article class="kpi-card">
        <div class="kpi-icon info">🤖</div>
        <div class="kpi-content">
          <span class="kpi-label">AI Actions</span>
          <span class="kpi-value">12</span>
          <span class="kpi-trend">3 pending review</span>
        </div>
      </article>
    </div>

    <!-- Main Grid -->
    <div class="dashboard-grid">
      <!-- Left Panel -->
      <div class="dashboard-main">
        <!-- AGM Status Card -->
        <article class="card agm-status-card">
          <header class="card-header">
            <h2>AGM-2026-001</h2>
            <span class="badge live">LIVE</span>
          </header>
          <div class="agm-progress">
            <div class="progress-ring" style="--progress: 78">78%</div>
            <div class="progress-info">
              <h4>AGM-2026-001</h4>
              <p>Agenda Item 6 of 9 · Motion M-003 active</p>
            </div>
          </div>
          <div class="agm-meta">
            <span class="meta-item">Quorum: 78% (312/400)</span>
            <span class="badge live">LIVE</span>
          </div>
        </article>

        <!-- Active Motions -->
        <article class="card">
          <header class="card-header">
            <h3>Active Motions</h3>
            <a href="#/motions" class="link">View all</a>
          </header>
          <ul class="motion-list">
            <li class="motion-item active">
              <span class="motion-id">M-003</span>
              <span class="motion-title">Board Election 2026-2029</span>
              <span class="badge voting">VOTING</span>
              <span class="vote-count">248/312</span>
            </li>
            <li class="motion-item">
              <span class="motion-id">M-004</span>
              <span class="motion-title">Dividend Declaration 8%</span>
              <span class="badge pending">PENDING</span>
            </li>
            <li class="motion-item">
              <span class="motion-id">M-005</span>
              <span class="motion-title">Budget Approval 2027</span>
              <span class="badge scheduled">SCHEDULED</span>
            </li>
          </ul>
        </article>

        <!-- AI Insights -->
        <article class="card ai-insights">
          <header class="card-header">
            <h3>🤖 AI Insights</h3>
            <span class="badge ai">6 agents active</span>
          </header>
          <ul class="insight-list">
            <li class="insight">
              <span class="insight-icon compliance">🛡️</span>
              <div>
                <strong>Compliance Alert</strong>
                <p>Motion M-004 requires UUK §7.3 review</p>
              </div>
            </li>
            <li class="insight">
              <span class="insight-icon secretary">📝</span>
              <div>
                <strong>Minutes Draft Ready</strong>
                <p>AGM-2026-001 minutes 87% complete</p>
              </div>
            </li>
            <li class="insight">
              <span class="insight-icon chairman">👑</span>
              <div>
                <strong>Time Alert</strong>
                <p>Agenda item 6: 2 minutes remaining</p>
              </div>
            </li>
          </ul>
        </article>
      </div>

      <!-- Right Sidebar -->
      <aside class="dashboard-sidebar">
        <!-- Quick Actions -->
        <article class="card quick-actions">
          <header class="card-header">
            <h3>Quick Actions</h3>
          </header>
          <div class="action-grid">
            <button class="action-btn primary">
              <svg>...</svg>
              <span>Start New AGM</span>
            </button>
            <button class="action-btn secondary">
              <span>Create Motion</span>
            </button>
            <button class="action-btn secondary">
              <span>Send Notice</span>
            </button>
            <button class="action-btn secondary">
              <span>Upload Document</span>
            </button>
          </div>
        </article>

        <!-- Upcoming Deadlines -->
        <article class="card deadlines">
          <header class="card-header">
            <h3>Upcoming Deadlines</h3>
          </header>
          <ul class="deadline-list">
            <li class="deadline-item urgent">
              <span class="deadline-date">2 days</span>
              <span class="deadline-title">M-004 Voting closes</span>
            </li>
            <li class="deadline-item">
              <span class="deadline-date">5 days</span>
              <span class="deadline-title">AGM Minutes due</span>
            </li>
            <li class="deadline-item">
              <span class="deadline-date">12 days</span>
              <span class="deadline-title">Board meeting prep</span>
            </li>
          </ul>
        </article>

        <!-- AI Agents Status -->
        <article class="card ai-status">
          <header class="card-header">
            <h3>🤖 AI Agents</h3>
          </header>
          <ul class="agent-list">
            <li class="agent active">
              <span class="agent-dot chairman"></span>
              <span class="agent-name">Chairman</span>
              <span class="agent-status active">Monitoring</span>
            </li>
            <li class="agent active">
              <span class="agent-dot secretary"></span>
              <span class="agent-name">Secretary</span>
              <span class="agent-status active">Drafting</span>
            </li>
            <li class="agent active">
              <span class="agent-dot compliance"></span>
              <span class="agent-name">Compliance</span>
              <span class="agent-status active">Reviewing</span>
            </li>
            <li class="agent active">
              <span class="agent-dot planner"></span>
              <span class="agent-name">Planner</span>
              <span class="agent-status active">Monitoring</span>
            </li>
            <li class="agent active">
              <span class="agent-dot nomination"></span>
              <span class="agent-name">Nomination</span>
              <span class="agent-status idle">Standby</span>
            </li>
            <li class="agent active">
              <span class="agent-dot questions"></span>
              <span class="agent-name">Questions</span>
              <span class="agent-status idle">Standby</span>
            </li>
          </ul>
        </article>
      </aside>
    </div>
  </main>
</div>
```

---

## Dashboard-Specific Styles

```css
/* Dashboard Layout */
.dashboard-layout {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  background: var(--color-card);
  border-right: 1px solid var(--color-border);
  padding: var(--space-lg);
  height: 100vh;
  position: sticky;
  top: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-lg);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-lg);
}

.logo {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--color-primary);
}

.sidebar-badge {
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-size: 0.625rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.nav-section-title {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted-foreground);
  margin-bottom: var(--space-sm);
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  text-decoration: none;
  transition: all 150ms ease;
}

.nav-item:hover {
  background: var(--color-muted);
  color: var(--color-foreground);
}

.nav-item.active {
  background: var(--color-primary);
  color: white;
}

.nav-item .badge {
  margin-left: auto;
  font-size: 0.625rem;
}

/* Top Bar */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-xl);
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.top-bar-left h1 {
  font-size: 1.5rem;
  font-weight: 800;
}

.subtitle {
  color: var(--color-muted-foreground);
  font-size: 0.875rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: var(--color-success);
  color: white;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.pulse {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-lg);
  padding: var(--space-xl) var(--space-xl);
}

.kpi-card {
  background: var(--color-card);
  border-radius: 12px;
  padding: var(--space-lg);
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  border: 1px solid var(--color-border);
}

.kpi-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.kpi-icon.primary { background: var(--color-primary); color: white; }
.kpi-icon.success { background: var(--color-success); color: white; }
.kpi-icon.warning { background: var(--color-warning); color: white; }
.kpi-icon.info { background: var(--color-info); color: white; }

.kpi-label {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 2rem;
  font-weight: 800;
  color: var(--color-foreground);
  line-height: 1.2;
}

.kpi-trend {
  font-size: 0.75rem;
  font-weight: 500;
}

.kpi-trend.positive { color: var(--color-success); }
.kpi-trend.negative { color: var(--color-destructive); }

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-xl);
  padding: 0 var(--space-xl) var(--space-xl);
}

.dashboard-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* Cards */
.card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--c-border);
}

.card-header h2,
.card-header h3 {
  font-size: 1rem;
  font-weight: 700;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 700;
}

.badge.live {
  background: var(--color-success);
  color: white;
  animation: pulse 2s infinite;
}

.badge.voting {
  background: var(--color-primary);
  color: white;
}

.badge.pending {
  background: var(--color-warning);
  color: white;
}

.badge.scheduled {
  background: var(--color-info);
  color: white;
}

/* KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-lg);
  padding: var(--space-xl) var(--space-xl);
}

.kpi-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: var(--space-lg);
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}

.kpi-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.kpi-icon.primary { background: var(--color-primary); color: white; }
.kpi-icon.success { background: var(--color-success); color: white; }
.kpi-icon.warning { background: var(--color-warning); color: white; }
.kpi-icon.info { background: var(--color-info); color: white; }

.kpi-label {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 2rem;
  font-weight: 800;
  color: var(--color-foreground);
  line-height: 1.2;
}

.kpi-trend {
  font-size: 0.75rem;
  font-weight: 500;
}

.kpi-trend.positive { color: var(--color-success); }
.kpi-trend.negative { color: var(--color-destructive); }

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-xl);
  padding: 0 var(--space-xl) var(--space-xl);
}

/* Sidebar */
.dashboard-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* Quick Actions */
.quick-actions .action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: var(--space-md);
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 150ms ease;
}

.action-btn.primary {
  background: var(--color-primary);
  color: white;
}

.action-btn.secondary {
  background: var(--color-muted);
  color: var(--color-foreground);
}

.action-btn:hover {
  transform: translateY(-1px);
}

/* Deadlines */
.deadline-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.deadline-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  border-radius: 8px;
  transition: background 150ms ease;
}

.deadline-item:hover {
  background: var(--color-muted);
}

.deadline-item.urgent {
  background: var(--color-destructive);
  color: white;
}

.deadline-date {
  font-size: 0.75rem;
  font-weight: 700;
}

.deadline-title {
  font-size: 0.875rem;
}

/* AI Agents */
.agent-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.agent {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: 8px;
  transition: background 150ms ease;
}

.agent:hover {
  background: var(--color-muted);
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.agent-dot.chairman { background: var(--color-warning); }
.agent-dot.secretary { background: var(--color-info); }
.agent-dot.compliance { background: var(--color-danger); }
.agent-dot.planner { background: var(--color-primary); }
.agent-dot.nomination { background: var(--color-accent); }
.agent-dot.questions { background: var(--color-success); }

.agent-name {
  font-size: 0.875rem;
  font-weight: 500;
  flex: 1;
}

.agent-status {
  font-size: 0.625rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}

.agent-status.active {
  background: var(--color-success);
  color: white;
}

.agent-status.idle {
  background: var(--color-muted);
  color: var(--color-muted-foreground);
}

/* KPI Cards */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-lg);
  padding: var(--space-xl) var(--space-xl);
}

.kpi-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: var(--space-lg);
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}

.kpi-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.kpi-icon.primary { background: var(--color-primary); color: white; }
.kpi-icon.success { background: var(--color-success); color: white; }
.kpi-icon.warning { background: var(--color-warning); color: white; }
.kpi-icon.info { background: var(--color-info); color: white; }

.kpi-label {
  font-size: 0.75rem;
  color: var(--color-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.kpi-value {
  font-size: 2rem;
  font-weight: 800;
  color: var(--color-foreground);
  line-height: 1.2;
}

.kpi-trend {
  font-size: 0.75rem;
  font-weight: 500;
}

.kpi-trend.positive { color: var(--color-success); }
.kpi-trend.negative { color: var(--color-destructive); }
```
