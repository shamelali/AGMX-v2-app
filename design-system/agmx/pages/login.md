# Login Page Override

> **Page:** Login (app.html#/login)
> **Overrides:** MASTER.md

---

## Layout

```html
<div class="login-layout">
  <div class="login-container">
    <div class="login-brand">
      <div class="logo-mark">AG</div>
      <div class="brand-text">
        <div class="b1">AGMX</div>
        <div class="b2">Governance OS</div>
      </div>
    </div>

    <div class="login-card">
      <header class="login-header">
        <h1>Welcome Back</h1>
        <p>Sign in to access your AGMX workspace</p>
      </header>

      <form class="login-form" id="login-form">
        <div class="form-group">
          <label for="email">Email Address</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="you@cooperative.my"
            required
            autocomplete="email"
            class="input"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <div class="password-wrapper">
            <input
              type="password"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              autocomplete="current-password"
              class="input"
            />
            <button type="button" class="toggle-password" aria-label="Toggle password visibility">
              <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </div>

        <div class="form-options">
          <label class="checkbox-wrapper">
            <input type="checkbox" name="remember" />
            <span>Remember me</span>
          </label>
          <a href="#forgot-password" class="forgot-link">Forgot password?</a>
        </div>

        <button type="submit" class="btn btn-primary btn-block">
          <span class="btn-text">Sign In</span>
          <span class="btn-loader" hidden>Signing in...</span>
        </button>
      </form>

      <div class="login-divider">
        <span>or continue with</span>
      </div>

      <div class="login-methods">
        <button type="button" class="login-method google">
          <svg class="icon">...</svg>
          <span>Continue with Google</span>
        </button>
        <button type="button" class="login-method microsoft">
          <svg class="icon">...</svg>
          <span>Continue with Microsoft</span>
        </button>
        <button type="button" class="login-method saml">
          <svg class="icon">...</svg>
          <span>Continue with SSO</span>
        </button>
      </div>

      <footer class="login-footer">
        <p>Don't have an account? <a href="#/signup">Sign up</a></p>
        <p class="demo-hint">Demo: admin@agmx.demo / demo123</p>
      </div>
    </div>

    <!-- Enterprise Features Sidebar -->
    <aside class="login-features">
      <h3>Enterprise Features</h3>
      <ul>
        <li><svg>...</svg> <span>SOC 2 Type II Certified</span></li>
        <li><svg>...</svg> <span>End-to-End Encryption</span></li>
        <li><svg>...</svg> <span>99.9% Uptime SLA</span></li>
        <li><span>PDPA</svg> <span>PDPA 2010 Compliant</span></li>
      </ul>
    </div>
  </div>
</div>
```

## Login-Specific Styles

```css
/* Login Layout */
.login-layout {
  min-height: 100vh;
  display: flex;
  background: var(--color-background);
}

.login-container {
  display: grid;
  grid-template-columns: 1fr 480px;
  min-height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
}

/* Left Panel - Brand */
.login-brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: var(--space-3xl);
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-700) 100%);
  color: white;
  position: relative;
  overflow: hidden;
}

.login-brand::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
  animation: float 20s infinite linear;
}

@keyframes float {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.logo-mark {
  width: 64px;
  height: 64px;
  background: white;
  color: var(--color-primary);
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
  margin-bottom: var(--space-lg);
}

.brand-text .b1 {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.brand-text .b2 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.8;
}

/* Right Panel - Form */
.login-card {
  padding: var(--space-3xl);
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: var(--color-card);
}

.login-header {
  text-align: center;
  margin-bottom: var(--space-2xl);
}

.login-header h1 {
  font-size: 1.75rem;
  font-weight: 800;
  margin-bottom: var(--space-sm);
}

.login-header p {
  color: var(--color-muted-foreground);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-foreground);
}

.password-wrapper {
  position: relative;
}

.password-wrapper .input {
  padding-right: 48px;
}

.toggle-password {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--color-muted-foreground);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.eye-icon {
  width: 20px;
  height: 20px;
}

.form-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-wrapper input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
}

.forgot-link {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 0.875rem;
}

.forgot-link:hover {
  text-decoration: underline;
}

.btn-block {
  width: 100%;
  padding: 14px 24px;
  font-size: 1rem;
}

.btn-loader {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn-loader[hidden] {
  display: none;
}

.login-divider {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  margin: var(--space-lg) 0;
  color: var(--color-muted-foreground);
  font-size: 0.875rem;
}

.login-divider::before,
.login-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.login-methods {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.login-method {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-foreground);
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 150ms ease;
}

.login-method:hover {
  background: var(--color-muted);
  border-color: var(--color-border-strong);
}

.login-method .icon {
  width: 20px;
  height: 20px;
}

.login-footer {
  margin-top: var(--space-xl);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.login-footer p {
  font-size: 0.875rem;
  color: var(--color-muted-foreground);
}

.login-footer a {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.login-footer a:hover {
  text-decoration: underline;
}

.demo-hint {
  font-size: 0.75rem !important;
  color: var(--color-muted-foreground) !important;
  font-family: monospace !important;
}

/* Enterprise Features Sidebar */
.login-features {
  background: linear-gradient(180deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
  padding: var(--space-2xl);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-lg);
}

.login-features h3 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: var(--space-lg);
}

.login-features ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.login-features li {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.875rem;
  color: var(--color-foreground);
}

.login-features svg {
  width: 20px;
  height: 20px;
  color: var(--color-primary);
  flex-shrink: 0;
}

/* Responsive */
@media (max-width: 1024px) {
  .login-container {
    grid-template-columns: 1fr;
  }

  .login-brand {
    display: none;
  }
}
