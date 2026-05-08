# Frontend Design Plan — "Crypto Operations Center"

**Tone**: Dark, industrial, precision-engineered. Bloomberg Terminal meets security SOC.

---

## Color System

| Role | Hex | Use |
|------|-----|-----|
| Surfaces | `#0B1120` (deep navy) | Main background |
| Elevated | `#131B2E` | Cards, panels |
| Borders | `#1E293B` | Subtle separation |
| Primary | `#22D3EE` (cyan) | Interactive elements, links |
| OAuth2 | `#F59E0B` (amber) | OAuth2-related UI |
| ZKP | `#10B981` (emerald) | ZKP-related UI |
| Attack | `#EF4444` (red) | Attack simulations |
| Text | `#F1F5F9` | Primary text |
| Muted | `#64748B` | Secondary text |

## Typography

- **Headers**: DM Sans — geometric, clean, sharp for data displays
- **Body**: Be Vietnam Pro — excellent Vietnamese diacritics (áàảãạ)
- **Monospace**: JetBrains Mono — all timestamps, proof data, token displays

## Spacing Scale (CSS Custom Properties)

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-8: 48px;
  --space-10: 64px;
  --space-12: 96px;
}
```

## Component-Level CSS Tokens (reuse across all components)

```css
/* Panels */
--panel-padding: var(--space-4);
--panel-border-radius: 6px;
--panel-gap: var(--space-4);

/* Inputs / Chat */
--input-height: 48px;
--input-padding: var(--space-3) var(--space-4);
--input-border-radius: 4px;

/* Buttons / Toggles */
--btn-height: 40px;
--btn-padding: var(--space-2) var(--space-4);
--btn-border-radius: 6px;
--toggle-height: 36px;

/* Borders / Dividers */
--border-radius-sm: 4px;
--border-radius-lg: 8px;
--border-radius-pill: 9999px;
--divider-width: 1px;

/* Navbar */
--navbar-height: 64px;

/* Typography */
--text-xs: 11px;
--text-sm: 13px;
--text-base: 16px;
--text-lg: 18px;
--text-xl: 24px;
--text-2xl: 28px;
--text-mono: JetBrains Mono;
```

---

## Pages

### 1 — Landing (`/`)

**Information hierarchy (viewport order):**
1. [FULL VIEWPORT — above the fold] Animated terminal-style headline as visual anchor
2. [FULL VIEWPORT — above the fold] Two "security console panels" side-by-side (not cards): OAuth2 (amber border) vs ZKP (emerald border) — equal visual weight, dominant content
3. [BELOW THE FOLD] 3-step horizontal flow with terminal arrow connectors
4. [BELOW THE FOLD] Two CTA tiles linking to Compare and Attacks
5. [BOTTOM] Optional: mini comparison table (3 rows: security, complexity, replay protection)

**CTA tiles (bottom of landing):**
Each tile is a 200×120px card with:
- Protocol name in large DM Sans text (e.g., "Compare Protocols")
- One-line description (e.g., "Side-by-side OAuth2 vs ZKP data flows")
- Amber border for "Compare" (educational), emerald border for "Try Attacks" (interaction)
- On hover: border brightens, subtle glow effect, cursor: pointer
- NOT cards with shadows — flat bordered rectangles with no box-shadow

**CTA tiles vs terminal panels:** The terminal panels (Landing sections 1–2) are FULL WIDTH of the viewport. The CTA tiles below are constrained to 480px max-width, centered, side-by-side. This visual hierarchy (large panels above → compact tiles below) reinforces that the comparison is the PRIMARY content.

- Full-viewport hero with animated terminal-style headline
- Two "security console panels" side-by-side (not cards): OAuth2 (amber border) vs ZKP (emerald border)
**Visual framing:** The two comparison panels are styled as **terminal console windows** — title bar with protocol name and status dot, scrollable monospace content area, and a thin amber or emerald left-border accent. NOT cards. NOT bordered boxes with shadow. Terminal windows anchored to a dark industrial background.
- 3-step horizontal flow with terminal arrow connectors
- Bottom: two CTA tiles linking to Compare and Attacks

### 2 — Chat (`/chat`)

**Information hierarchy (top-to-bottom layout):**
1. [TOP — compact, 48px] Agent selector toggle (amber/emerald badge switch)
2. [THIN BAR — below selector] ZKP step indicator: 5-stage horizontal progress bar with animated transitions
3. [CENTER — ~60% of viewport] Message area: dark terminal-style chat bubbles, monospace user input
4. [BOTTOM — appears after messages] Results rendered as forensic evidence panels:
  - Intent → structured data card with monospace key-value pairs
  - Auth info → protocol-colored panel with badge, timing, token preview
  - Proof → forensic expandable section with hex dump
  - Timing → animated horizontal bar chart

### 3 — Compare (`/compare`)

**Information hierarchy (educational split-screen):**
1. [TOP — across full width] Page headline explaining the comparison purpose
2. [CENTER — true split-screen] Left OAuth2 (amber border), Right ZKP (emerald border)
3. [BOTTOM] Consolidated comparison table for quick reference

**Each side contains (top-to-bottom):**
1. Protocol badge + security rating (compact header)
2. **Step-by-step data flow diagram (primary educational content)** — see structure below
3. Security checklist showing what's vulnerable vs protected
4. Timing breakdown (animated bar charts) and data size as secondary metrics

**OAuth2 data flow — PKJWT (RFC 7523) — step structure (5 steps, two-column request/response format):**
```
┌─ TERMINAL WINDOW ─────────────────────────────────┐
│ ● 1. Client creates signed JWT client_assertion   │
│    LOCAL     RS256(payload, private_key.pem)      │
│    CLAIMS    { iss: agent_id, sub: agent_id,      │
│                aud: "https://oauth.example.com", │
│                iat: now, exp: now+300, jti: uuid }  │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ● 2. Client sends assertion to token endpoint    │
│    REQUEST   POST /api/auth/oauth2/token         │
│    BODY       client_id=agent_id                  │
│                client_assertion=<JWT>             │
│    RESPONSE  ← 200 { access_token: "eyJ..." }    │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ● 3. Client sends access_token to intent API    │
│    REQUEST   POST /api/chat/intent                │
│    HEADER    Authorization: Bearer eyJ...          │
│    RESPONSE  ← 200 { auth_info: { type, ... } }  │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ⚠ 4. ATTACK: Forged assertion — stolen private key│
│    FORGED   Attacker signs fake assertion with    │
│             stolen private key → gets access_token │
└────────────────────────────────────────────────────┘
```

*Step 4 note:* In PKJWT the vulnerability is NOT token interception (HTTPS protects the wire) — it is forged assertion (attacker with private key impersonates the agent). The old "network interception" attack from the bcrypt flow is no longer applicable with HTTPS. The proper mitigation is private key protection on the client side.

**ZKP data flow — step structure (5 steps, with per-step highlight):**
Each step row: bullet (● for normal, ⚠ for vulnerable) | step title | two-column miniframe showing REQUEST → RESPONSE in monospace.

**ZKP data flow — step structure (5 steps, with per-step highlight):**
```
┌─ TERMINAL WINDOW ────────────────────────────────────────────┐
│ ● 1. Server issues challenge token (random, single-use)     │
│    REQUEST   GET /zkp-challenge/{agent_id}                  │
│    RESPONSE  ← 200 { zkp_token: "challenge_abc..." }        │
│              ⚡ Token TTL: 60 seconds                         │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ● 2. Client computes Schnorr proof LOCALLY (password never   │
│      sent to server)                                         │
│    LOCAL     computeProof(password, zkp_token)               │
│    OUTPUT    { commitment: "g^r", response: "r + H(t||token)*x" } │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ● 3. Client sends message + proof to intent API             │
│    REQUEST   POST /intent { message, zkp_token, zkp_proof }  │
│    PASSWORD  ← NOT SENT                                      │
│    RESPONSE  ← 200 { auth_info: { type: "zkp", ... } }      │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ ● 4. Server verifies proof against stored public_key        │
│    VERIFY    g^s ≟ t × y^c (mod p)                          │
└─────────────────────────────────────────────────────────────┘
```

**Center divider: Live security rating indicator**
- Vertical divider line (2px, gradient: amber to emerald)
- At each step, the divider shows an animated indicator: OAuth2 side has a red pulsing dot; ZKP side has a green solid dot
- After full flow: each side shows a final security grade (e.g., "68/100 VULNERABLE" in red; "95/100 SECURE" in green)
- Rating formula: OAuth2 = fixed low score (token-based, replay-vulnerable), ZKP = fixed high score (ZK proof, replay-protected). Animation on load: bars fill from 0 to final value over 800ms.

**Security checklist (per side, below diagram):**
OAuth2 PKJWT checklist (amber theme):
- [x] Private key must be kept secure on client — if stolen, attacker can forge assertions
- [ ] Server stores only public key — cannot derive the private key (✓ — server is safe even if DB is breached)
- [x] Vulnerable to forged assertion if private key is compromised (attacker signs fake JWT with stolen key)
- [ ] Access token can still be stolen from wire (HTTPS mitigates, but token is bearer)
- [x] Zero-knowledge — no (server never sees the private key, but the threat model is forged signatures, not ZK)

ZKP checklist (emerald theme):
- [x] No password stored on server
- [x] Replay-protected (single-use challenge tokens)
- [x] Server only sees public key (not password)
- [x] Zero-knowledge proof — server cannot derive password

### 4 — Attacks (`/attacks`)

**Information hierarchy (education-first, top-to-bottom):**
1. [TOP] Attack selector: three buttons (Replay, Token Theft, Credential Stuffing)
2. [CENTER — dominant area] Split execution with annotated step labels: OAuth2 side shows breach animation (red flash, data exfiltration) with step-by-step labels explaining what's happening; ZKP side shows shield animation (green pulse) with corresponding protection labels
3. [BELOW] Forensics cards: what was stolen (OAuth2) vs what was protected (ZKP)
4. [BOTTOM] Timing comparison bar chart

**Animation specifications (not yet specced):**

OAuth2 breach sequence (triggered on attack selection, auto-plays once):
| Time | Event |
|------|-------|
| 0ms | Both panels dim slightly (opacity → 0.7) |
| 200ms | Red overlay flashes on OAuth2 panel (opacity 0.3 → 0, 150ms ease-out) |
| 400ms | Token value blinks (3× rapid amber, 80ms per blink) |
| 600ms | "EXFILTRATED" label appears with red background, shakes once (translateX ±4px, 3 cycles) |
| 900ms | OAuth2 panel border turns red (#EF4444), stays |
| 1200ms | Animation complete, "Repeat" button appears on OAuth2 panel |

ZKP protection sequence (triggered simultaneously):
| Time | Event |
|------|-------|
| 0ms | Emerald pulse expands from center of ZKP panel (opacity 0 → 0.4 → 0, scale 1x → 1.2x, 400ms) |
| 200ms | Shield icon appears (fade-in + slight scale-up, 200ms) |
| 400ms | "PROOF ACCEPTED — NO DATA EXPOSED" label slides in from bottom |
| 700ms | ZKP panel border turns green (#10B981) |
| 1000ms | Animation complete |

Controls: "Replay" button on OAuth2 side to re-run the attack animation. "Reset" button to clear both animations and return to neutral state.

**Forensics cards:**
- OAuth2 (red-bordered card): "Data exfiltrated: Access token. Validity: 3600s. Threat: Token replay, man-in-the-middle." Shows the actual stolen token string in monospace (truncated, e.g. `eyJhbGciOiJI...`)
- ZKP (green-bordered card): "Data exposed: None. Proof size: ~200 bytes (public only). Threat: None identified."

---

## Components to Rewrite

| Component | Old | New |
|-----------|-----|-----|
| Navbar | White strip, text links | Dark glass, pill-style tabs with active indicator |
| ZKPFlow | Vertical numbered list | 5-step horizontal progress bar, animated transitions |
| GhostResults | Empty state text | Terminal-style "waiting for input..." with blinking cursor |
| IntentCard | Plain bordered div | Structured data card with monospace key-value pairs |
| AuthInfoPanel | Simple text | Protocol-colored panel with badge, timing, token preview |
| ProofAccordion | Basic collapsible | Forensic expandable section with hex dump, copy button |
| TimingBreakdown | Text list | Animated horizontal bar chart with milliseconds |

---

## Interaction States

| Page / Feature | Loading | Empty | Error | Success | Partial / Edge |
|---|---|---|---|---|---|
| **Landing** — Hero & panels | Skeleton shimmer on panels (cyan pulse on borders, text as dimmed placeholder rectangles) | N/A (hero is static content) | Red error banner at top if data fails to load with retry button | Staggered fade-in of headline → panels → stepper → CTAs (200ms intervals) | Slow connection: panels show dimmed placeholder text until data resolves |
| **Chat** — Agent selector | Toggle buttons disabled with amber/emerald skeleton pulse | Default: OAuth2 pre-selected. No empty state needed. | N/A (local toggle, no network) | Smooth toggle transition with protocol color swap | N/A |
| **Chat** — Message area | Terminal-style "Connecting..." with animated cursor blink and dimmed input field | First visit: GhostResults shows blinking cursor + "Waiting for your request..." in monospace amber text | Error bubble: red-bordered message with "Connection failed" + "Retry" button. Network error: amber warning above input | Monospace success checkmark + "Intent processed" in green. Message appears in chat | Partial response: streaming indicator (pulsing dot) while response builds |
| **Chat** — ZKP challenge fetch | "Fetching challenge..." text replaces message area, amber spinner (not the full loading state) | N/A | "Challenge failed — check connection" in red text with retry button | Token fetched: "Challenge received ✓" briefly shown, 600ms, auto-advances | Token expired: auto-refetch once, then show "Token expired — retrying..." |
| **Chat** — ZKP proof computation | "Computing proof..." with animated step indicator (steps 1–2 of progress bar fill), progress bar shows 2/5 | N/A | "Proof failed" — rare (code bug) | "Proof computed ✓" — step 3 of progress bar fills, advances to server verification | Slow device: per-step timer ticks in real-time, user sees "s=(r+c·x) mod q" being computed |
| **Chat** — ZKP server verification | "Verifying..." — steps 4–5 of progress bar animate, server request in flight | N/A | "Verification failed — possible replay attack" with red progress bar flash and error detail | Steps 4–5 complete: green checkmark, "verified" label, full auth panel appears | Timeout (server slow): "Verifying..." stays up to 10s, then "Verification timed out — retry" |
| **Chat** — ZKP proof verification | Progress bar animates through 5 steps with current step highlighted | N/A | Proof failed: red flash on progress bar + "Verification failed — possible replay attack" error message with "Try again" button | Green checkmark on final step + "Proof verified" with timing | Slow verification: per-step timer shown on each progress segment |
| **Attacks** — Execution area | Attack buttons pulse with cyan border while awaiting selection; during attack simulation: OAuth2 side gets red overlay flash, ZKP side gets emerald pulse (both play simultaneously, ~1200ms) | N/A (attack selector always visible) | Simulate button shows "Simulation error — try again" with red pulse on the failed side; other side completes normally | Breach animation (OAuth2): red flash → token blink → EXFILTRATED label → red border; Shield animation (ZKP): emerald pulse → shield icon → PROTECTED label → green border. Both animations run ~1200ms. | Animation interrupted: OAuth2 side stops at whatever frame it was on, red border, "Simulation incomplete" note appears |
| **Attacks** — Replay button (OAuth2 side) | Disabled with pulsing amber border while animation replays | N/A | N/A (replay always succeeds visually — it's a demo, not real attack) | Animation re-triggers: red flash → token blink → EXFILTRATED label → final state. Replay button re-enables after ~1500ms debounce | Rapid replay: clicks ignored during debounce window. Queue is dropped (1.5s dead period) |
| **Attacks** — Forensics cards | Cards invisible (display: none) before first attack runs | N/A | If attack data unavailable for one side: that forensics card shows "No data available" in muted text | OAuth2: red-bordered card with stolen token in monospace (truncated). ZKP: emerald-bordered card with "None" and proof size. Both animate in (fade + slide-up) when corresponding animation completes | |
| **Compare** — Split panels | Both sides show skeleton layout: protocol badge placeholder, timing bar ghosts, checklist dimmed | N/A (static content with live data) | Error banner: "Comparison data unavailable" with retry. One side fails: show error on that side, other side still loads | Full render with animated timing bars (width 0→value) and badge glow | One side loads faster: show loaded side immediately, other side continues loading (progressive enhancement) |

## Motion

- **Page load**: Staggered fade-in on panels (200ms intervals)
- **Attack simulation**: Red border flash + shake on breach, green pulse + shield on block
- **ZKP proof**: Step-by-step progress bar with checkmark animation
- **Timing bars**: Animate width from 0 to value on reveal
- **Security badge**: Subtle glow pulse on secure (green), warning pulse on vulnerable (amber)

---

## User Journey Storyboard

Teaching moment → emotional arc for first-time users:

| Step | User does | User feels | Design supports it |
|------|-----------|------------|-------------------|
| 1. Landing loads | Scans hero, sees two terminal windows with amber/epmerald borders | Curious — what IS this? Professional, serious, not flashy | Terminal window framing signals "this is a technical tool" not a toy |
| 2. Clicks "Compare" | Reads OAuth2 vs ZKP data flow side-by-side | "Oh — so OAuth2 sends the client_secret to the server, but ZKP doesn't?" | Data flow diagrams as true split-screen with numbered step rows, no scrolling needed to see the difference |
| 3. On Compare: reads security checklist | Sees OAuth2 has vulnerabilities checklist vs ZKP clean bill | "ZKP just... doesn't store the password. That's the key difference." | Color-coded checklist with checkmarks/crosses — scannable in 10 seconds |
| 4. Goes to Chat, selects ZKP, types "search for Laptop" | Sees proof computation in real-time (50ms), sees proof verification 5-stage progress | "Wait — it computed it on MY machine? The server never got my password?" | ZKP progress bar showing step-by-step: challenge fetched → proof computed locally → server verifies. The flow makes the security property tangible. |
| 5. Goes to Attacks, runs Replay attack on OAuth2 | Sees red flash, token blink, "EXFILTRATED" | "That's... really bad. Anyone who grabs this token has full access for an hour." | The OAuth2 breach animation with explicit token exfiltration display makes the vulnerability visceral |
| 6. Same attack on ZKP side | Sees green pulse, shield, "PROOF ACCEPTED — NO DATA EXPOSED" | "The ZKP side just... worked, and nothing was stolen. Because the token itself is useless." | Side-by-side comparison makes the contrast immediate and memorable |

---

## NOT in Scope

- Mobile / responsive layout — desktop-only demo. Fixed layout assumes 1280px+ viewport. Below 1024px: Compare split-screen stacks vertically (OAuth2 above, ZKP below), Attacks split-screen stacks vertically, Chat page remains usable at 1024px with full agent selector and message area preserved.
- Accessibility (a11y) specs — explicitly deferred by user preference
- Mobile nav behavior (hamburger pattern) — desktop only, not applicable
- Screen reader / ARIA specs — desktop-only classroom demo, no public deployment planned
- Touch target sizing on mobile — no mobile target
- Multi-language support — all UI strings in English (except existing Vietnamese strings in component code, which are out-of-band artifacts from a prior session and should be replaced with English equivalents)

## What Already Exists

- **`frontend/src/components/`** — All 7 components listed for rewrite already exist as basic implementations:
  - `Navbar.jsx` — white strip with text links (target: dark glass with pill tabs)
  - `ZKPFlow.jsx` — vertical numbered list (target: horizontal 5-step progress bar)
  - `GhostResults.jsx` — empty state text (target: terminal-style blinking cursor)
  - `IntentCard.jsx` — plain bordered div (target: structured data card with monospace)
  - `AuthInfoPanel.jsx` — simple text (target: protocol-colored panel with badge)
  - `ProofAccordion.jsx` — basic collapsible (target: forensic hex dump accordion)
  - `TimingBreakdown.jsx` — text list (target: animated bar charts)
- **`frontend/src/lib/zkp.js`** — Client-side Schnorr ZKP library exists: `computeProof()`, `hashSecret()`, `createPublicKey()`. Fully implemented, to be wired into Chat flow in Task 10.
- **`frontend/src/services/chatApi.js`** — API service exists for the chat endpoints.
- **`frontend/DESIGN_PLAN.md`** — This plan file itself (the one being reviewed).
- ⚠ **`frontend/src/index.css`** — **FULL REPLACEMENT REQUIRED.** The current file is 100% light theme (`--color-bg: #ECFEFF`, `--color-surface: #FFFFFF`, `--color-text: #164E63`), uses `Fira Sans` + `Fira Code`, and defines a full `:root` block and base styles on a completely different aesthetic. When implementing the dark theme, `index.css` must be **replaced entirely** — the new `:root` block (deep navy #0B1120 background, DM Sans + Be Vietnam Pro + JetBrains Mono fonts, all color tokens from the Color System above) completely supersedes this file. Do not partially overwrite. Do not mix old and new variables. The new theme and the old theme are incompatible — one replaces the other.
- **`frontend/src/components/`** — Existing components have Vietnamese UI strings and partial implementations (ZKPFlow: vertical list; AuthInfoPanel: badge+timing but no protocol color theme; ProofAccordion: expandable but no hex dump format). These are the targets for rewrite listed in "Components to Rewrite" below.

---

## Decisions Made vs. Deferred

### Made (Session 3 — 2026-05-08)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Add full CSS spacing scale (`--space-1`: 4px → `--space-12`: 96px) | `--space-4` referenced everywhere but undefined — implementer would have to guess. 4/6/8/12/16/24/32/48/64/96 scale is standard. |
| D2 | Specify Compare data flow diagram as terminal window format with REQUEST/RESPONSE columns | "Data flow diagram" was vague. Specified as: terminal window shell, numbered steps, REQUEST → RESPONSE two-column per step, bullet markers (● = normal, ⚠ = vulnerable). |
| D3 | Add ZKP three-phase states to Interaction States (challenge fetch, proof computation, server verification) separately | The ZKP flow has 3 network/code phases. Each phase has distinct loading/error states now specced. |
| D4 | Add 5-row User Journey Storyboard (compare → chat → attacks sequence) | Documents the emotional arc: curiosity → understanding → visceral demonstration. Makes design decisions traceable. |
| D5 | Add 1.5s debounce + Replay/Reset controls for attack animations | No stop/replay controls were specced. Prevents accidental double-trigger. |
| D6 | Specify OAuth2 breach + ZKP protection animation per-ms timing tables | "Red flash" was the only animation spec. Now 6-row timing table for OAuth2, 5-row for ZKP. |
| D7 | Specify Compare center divider as security rating bar: 68/100 VULNERABLE (red), 95/100 SECURE (green), bar fills over 800ms | Security rating was mentioned but value/visualization unspecified. Fixed values now: 68 (OAuth2), 95 (ZKP). |
| D8 | Add viewport behavior to NOT in Scope: below 1024px, Compare/Attacks stack vertically | Breakpoint guidance added without full responsive commitment. |
| D9 | Flag Vietnamese strings in existing components: ZKPFlow labels, AuthInfoPanel headers | Components have hardcoded Vietnamese ("Bạn nhập mật khẩu", "Xác thực", "Chi tiết proof"). Need replacement with English equivalents per this plan's language. |
| D10 | Lock DF4: use Unicode `→` in JetBrains Mono for arrow connectors (not SVG). JetBrains Mono is already loaded for terminal content — zero additional cost. Authentic terminal aesthetic without a React SVG dependency. |

### Deferred

| # | Decision | If deferred, what happens |
|---|----------|--------------------------|
| DF1 | ProofAccordion hex display: byte grouping (4 vs 8 byte), ASCII sidebar (yes/no), uppercase vs lowercase hex, 0x00 color | Each implementer ships a different format. Will look inconsistent. |
| DF2 | Compare security rating visualization: circular gauge vs linear bar vs letter badge | "Rating" stays abstract. Pick once, reuse everywhere. |
| DF3 | Landing hero headline exact copy | Developer uses placeholder. Recommend: "Agent Authentication: OAuth2 vs Zero-Knowledge Proof". |

---

## Implementation Order

**Big Bang release — CSS overhaul + ALL pages + ALL components ship together.**
The listed order (1 CSS → 2 Navbar → 3 Landing → ...) is coding priority only. Nothing is shown to users until the full migration is complete. During the transition, CSS variables in the new dark theme replace the old light-theme `:root` block — all pages depend on `var(--color-bg)`, `var(--color-text)`, etc. There is no meaningful "working" state where some pages use the old theme and some use the new. Complete the migration, then deploy.

1. CSS theme overhaul (variables, base styles, fonts, component-level tokens)
2. Navbar redesign
3. Landing page
4. Chat page + ZKP client-side flow
5. Compare page
6. Attacks page
7. All sub-components (ZKPFlow, GhostResults, etc.)
---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | issues_open | 8+5=13 issues, 1 unresolved, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 3 | CLEARED | Session 1: score 4/10 → 8/10, 7 decisions. Session 2: 8/10 → 9/10, 9 decisions made, 4 deferred (DF1–DF4). Session 3 (this review): 9/10 → 9.5/10, 2 new decisions (D10, full CSS replacement guidance), Attacks page missing state table fixed. 3 deferred remaining (DF1–DF3). |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**DESIGN SCORE:** 9/10 → **9.5/10** — 3 deferred decisions remain (DF1: ProofAccordion hex format, DF2: security rating visualization, DF3: landing headline copy). All other dimensions at 10/10.

**DECISIONS MADE THIS SESSION (Session 3):** 2 (D10: arrow rendering locked to JetBrains Mono; CSS replacement guidance documented in What Already Exists)

**DECISIONS MADE ALL TIME:** 11 (D1–D10 + CSS replacement guidance)

**DECISIONS DEFERRED:** 3 (DF1–DF3 — all have concrete if-deferred consequences documented)

**DESIGN GAPS FIXED (Session 3):**
1. `index.css` full replacement gap documented — old light theme must be entirely replaced, not partially overwritten (added to What Already Exists)
2. Attacks page interaction states added to Interaction States table (new rows for execution area, forensics cards, replay button debounce)

**REMAINING GAPS (DF1–DF3):**
- DF1 (ProofAccordion hex): byte grouping, ASCII sidebar, hex case not settled. Implementer: recommend 8-byte grouping, uppercase hex, no ASCII sidebar, JetBrains Mono 12px with line numbers.
- DF2 (security rating viz): circular gauge vs linear bar not chosen. Both sides of Compare page have placeholder "bar fills over 800ms" — implementer should pick one and spec the visual exactly.
- DF3 (landing headline): exact copy not set. Recommend: "Agent Authentication: OAuth2 vs Zero-Knowledge Proof" — pick once.

**VERDICT:** Design 9.5/10 — 3 deferred decisions (DF1–DF3, all have concrete if-deferred consequences documented). All pages and components are specced to ≥9.5/10. The gap is isolated to ProofAccordion hex format — the only UI element not fully locked. Recommend: implement the full app (dark theme, all 4 pages, all 7 components), defer DF1 hex format until the Attacks/Compare forensic cards are built, then make the final call when you see it in context.

**Note on prior reviews:** Repo has no commits. All review status should be re-evaluated once the repo has commits.
