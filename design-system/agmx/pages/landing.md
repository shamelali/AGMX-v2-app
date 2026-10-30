# Landing Page Override

> **Page:** Landing Page (index.html)
> **Overrides:** MASTER.md

---

## Hero Section

```html
<header class="hero">
  <div class="container hero-grid">
    <div class="hero-content">
      <span class="badge badge-accent">Enterprise SaaS for Malaysian Cooperatives</span>
      <h1>AGMX <span class="highlight">Governance OS</span></h1>
      <p class="hero-subtitle">Enterprise-grade AGM Operating System for Malaysian cooperatives. Compliance-by-design, AI-powered governance, enterprise-grade security.</p>
      <div class="hero-actions">
        <a href="#pricing" class="btn btn-primary btn-lg">Start Free Assessment</a>
        <a href="#demo" class="btn btn-secondary btn-lg">Watch Demo</a>
      </div>
      <div class="hero-trust">
        <div class="trust-item">
          <span class="trust-number">500+</span>
          <span class="trust-label">Cooperatives</span>
        </div>
        <div class="trust-item">
          <span class="trust-number">99.9%</span>
          <span class="trust-label">Uptime SLA</span>
        </div>
        <div class="trust-item">
          <span class="trust-number">SOC 2</span>
          <span class="trust-label">Certified</span>
        </div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="dashboard-preview">
        <div class="preview-header">
          <div class="window-controls">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="preview-content">
          <div class="preview-sidebar">
            <div class="sidebar-item active">Dashboard</div>
            <div class="sidebar-item">Members</div>
            <div class="sidebar-item">AGM Live</div>
            <div class="sidebar-item">Voting</div>
          </div>
          <div class="preview-main">
            <div class="preview-card">
              <div class="card-header">Quorum Status</div>
              <div class="progress-ring" style="--progress: 78">78%</div>
              <div class="progress-label">Quorum Achieved</div>
            </div>
            <div class="preview-card">
              <div class="card-header">Active Motions</div>
              <div class="motion-item">M-001: Dividend Declaration</div>
              <div class="motion-item">M-002: Board Election</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</header>
```

## Trust Bar

```html
<section class="trust-bar">
  <div class="container">
    <div class="trust-grid">
      <div class="trust-item">
        <div class="trust-icon"><svg>...</svg></div>
        <span class="trust-number">500+</span>
        <span class="trust-label">Cooperatives</span>
      </div>
      <div class="trust-item">
        <span class="trust-number">99.9%</span>
        <span class="trust-label">Uptime SLA</span>
      </div>
      <div class="trust-item">
        <span class="trust-icon">SOC 2</span>
        <span class="trust-label">Type II Certified</span>
      </div>
      <div class="trust-item">
        <span class="trust-number">99.9%</span>
        <span class="trust-label">Data Uptime</span>
      </div>
    </div>
  </div>
</section>
```

## Features Grid

```html
<section class="features-section">
  <div class="container">
    <header class="section-header">
      <span class="section-label">Platform Capabilities</span>
      <h2>Enterprise-Grade Governance Platform</h2>
      <p>Built for Malaysian cooperatives. Compliance-by-design, AI-powered, enterprise-grade.</    </header>
    <div class="features-grid">
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-primary); color: white;">
          <svg>...</svg>
        </div>
        <h3>Compliance-by-Design</h3>
        <p>Built-in Akta Koperasi 1993, GP14, GP14B, UUK compliance engine</p>
      </article>
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-accent); color: white;">
          <svg>...</svg>
        </div>
        <h3>AI Governance Copilot</h3>
        <p>6 specialized agents: Chairman, Secretary, Compliance, Planner, Nomination, Questions</p>
      </article>
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-secondary); color: white;">
          <svg>...</svg>
        </div>
        <h3>E-Voting & Ballots</h3>
        <p>Secret ballots, receipt verification, maker-checker, immutable audit trail</p>
      </article>
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-accent); color: white;">
          <svg>...</svg>
        </div>
        <h3>AGMX LIVE</h3>
        <p>Hybrid AGM: video, captions, speaker queue, live voting, emergency controls</p>
      </article>
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-success); color: white;">
          <svg>...</svg>
        </div>
        <h3>Evidence Vault</h3>
        <p>Immutable audit trail, immutable hash chain, exportable evidence packages</p>
      </article>
      <article class="feature-card">
        <div class="feature-icon" style="background: var(--color-accent); color: white;">
          <svg>...</svg>
        </div>
        <h3>Senior Accessibility</h3>
        <p>60-80px targets, 18px base font, high contrast, screen reader optimized</p>
      </article>
    </div>
  </div>
</section>
```

## Pricing Section (Enterprise)

```html
<section id="pricing" class="pricing-section">
  <div class="container">
    <header class="section-header">
      <span class="section-label">Pricing</h2>
      <h2>Enterprise Pricing</h2>
      <p>Annual subscription. All tiers include full governance core.</p>
    </header>
    <div class="pricing-grid">
      <article class="pricing-card">
        <div class="plan-badge">SMALL</div>
        <h3>Small</h3>
        <div class="price">RM 499<span>/year</span></div>
        <p class="plan-desc">1-299 members · Founding 100 price</p>
        <ul class="features">
          <li>Full governance core</li>
          <li>1 AGM/year included</li>
          <li>E-Voting & ALK elections</li>
          <li>Akta/GP14/UUK compliance</li>
          <li>AI Secretary & Compliance</li>
          <li>Evidence Vault</li>
          <li>Standard support</li>
        </ul>
        <a href="#" class="btn btn-primary btn-block">Start Free Assessment</a>
      </article>
      <article class="pricing-card featured">
        <div class="plan-badge popular">POPULAR</div>
        <h3>Growth</h3>
        <div class="price">RM 1,199<span>/year</span></div>
        <p class="plan-desc">300-999 members · Founding 100 price</p>
        <ul class="features">
          <li>All Small features</li>
          <li>Unlimited AGMs</li>
          <li>Higher LIVE capacity</li>
          <li>Full AI Copilot (6 agents)</li>
          <li>Accessibility mode</li>
          <li>CSV Import/Export</li>
          <li>Digital Meeting Pack</li>
          <li>Priority support</li>
        </ul>
        <a href="#" class="btn btn-accent btn-block">Start Free Assessment</a>
      </article>
      <article class="pricing-card">
        <h3>Enterprise</h3>
        <div class="price">RM 2,999<span>/year</span></div>
        <p class="plan-desc">1,000+ members · Founding 100 (from)</p>
        <ul class="features">
          <li>All Growth features</li>
          <li>Enterprise-scale capacity</li>
          <li>Full AI + RAG</li>
          <li>Hybrid AGM (LIVE)</li>
          <li>API Integration</li>
          <li>Multi-language (BM/EN/TA/ZH)</li>
          <li>Guided onboarding</li>
          <li>Enterprise support</li>
        </ul>
        <a href="#" class="btn btn-primary btn-block">Get Quote</a>
      </article>
      <article class="pricing-card">
        <h3>Enterprise+</h3>
        <div class="price">Custom</div>
        <p class="plan-desc">10,000+ / Multi-cooperative</p>
        <ul class="features">
          <li>All Enterprise features</li>
          <li>White-label branding</li>
          <li>Dedicated account manager</li>
          <li>Custom architecture / DR</li>
          <li>Written operational SLA</li>
          <li>Custom training</li>
          <li>Legacy system integration</li>
          <li>Custom commercial terms</li>
        </ul>
        <a href="#" class="btn btn-primary btn-block">Contact Sales</a>
      </article>
    </div>
  </div>
</section>
```

## Enterprise Trust Section

```html
<section class="trust-section">
  <div class="container">
    <header class="section-header">
      <span class="section-label">Trust & Compliance</h2>
      <h2>Enterprise-Grade Trust</h2>
      <p>Built for regulated environments. Audit-ready from day one.</p>
    </header>
    <div class="trust-grid">
      <article class="trust-card">
        <div class="trust-icon">🛡️</div>
        <h3>SOC 2 Type II</h3>
        <p>Annual audits, continuous monitoring</p>
      </article>
      <article class="trust-card">
        <div class="trust-icon">🔐</div>
        <h3>End-to-End Encryption</h3>
        <p>AES-256 at rest, TLS 1.3 in transit</p>
      </article>
      <article class="trust-card">
        <div class="trust-icon">🔐</div>
        <h3>Data Residency</h3>
        <p>Malaysia data centers available</p>
      </article>
      <article class="trust-card">
        <div class="trust-icon">📋</div>
        <h3>PDPA Compliant</h3>
        <p>Malaysia PDPA 2010 compliant</p>
      </article>
      <article class="trust-card">
        <div class="trust-icon">⚡</div>
        <h3>99.9% SLA</h3>
        <p>Financially backed uptime guarantee</p>
      </article>
      <article class="trust-card">
        <div class="trust-icon">📋</div>
        <h3>Audit Trail</h3>
        <p>Immutable hash chain, tamper-evident</p>
      </article>
    </div>
  </div>
</section>
```

## Footer (Enterprise)

```html
<footer class="footer-enterprise">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="logo">AGMX</div>
        <p>Enterprise Governance OS for Malaysian Cooperatives</p>
      </div>
      <nav>
        <h4>Product</h4>
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#security">Security</a>
        <a href="#integrations">Integrations</a>
      </nav>
      <nav>
        <h4>Company</h4>
        <a href="#about">About</a>
        <a href="#blog">Blog</a>
        <a href="#careers">Careers</a>
        <a href="#contact">Contact</a>
      </nav>
      <nav>
        <h4>Resources</h4>
        <a href="#docs">Documentation</a>
        <a href="#api">API Reference</a>
        <a href="#help">Help Center</a>
        <a href="#status">Status</a>
      </nav>
      <nav>
        <h4>Legal</h4>
        <a href="#privacy">Privacy</a>
        <a href="#terms">Terms</a>
        <a href="#compliance">Compliance</a>
        <a href="#cookies">Cookies</a>
      </nav>
    </div>
    <div class="footer-bottom">
      <p>© 2026 AGMX. All rights reserved.</p>
    </div>
  </div>
</footer>
```
