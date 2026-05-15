# UI Design Plan: Attack Simulation (Industrial Terminal)

## 1. Design Direction Summary
*   **Aesthetic Name:** *Industrial Terminal / Protocol Forensics*
*   **DFII Score:** 14/15
*   **Key Inspiration:** Network packet analyzers (Wireshark), hardware diagnostic tools, and declassified technical dossiers.
*   **Purpose:** To transform the attack simulation from a generic status dashboard into a high-stakes, technical forensic environment that visually reinforces the cryptographic superiority of ZKP.
*   **Differentiation Anchor:** **The "Oscilloscope" Feed.** During scanning, render a scrolling stream of hex-encoded data chunks (simulating intercepted buffers) resolving into the final readout.

## 2. Design System & Mapping
*   **Typography:** `IBM Plex Mono` (Monospaced). Min size 13px for body, 11px for metadata.
*   **Variable Mapping:**
    *   `--color-attack` → `--terminal-accent` (#f87171 - Red)
    *   `--color-zkp` → `--terminal-secure` (#34d399 - Green)
    *   `--color-bg` → `--terminal-bg` (#0a0a0b)
    *   `--color-border` → `--terminal-border` (#1e1e22)
    *   `--color-text` → `--terminal-text` (#e5e7eb)
    *   `--color-muted` → `--terminal-muted` (#4b5563)

## 3. Information Hierarchy
### Left Panel (Mission Control)
1. **[COMPARE MODE]**: Primary action, runs comprehensive audit.
2. **Auth Filter**: [ALL / OAUTH2 / ZKP] toggles.
3. **Attack List**: Grouped by target auth type.

### Right Panel (Forensics Readout)
1. **Status Line**: `[●] VULNERABLE | oauth2 | replay` (Red ● or Green ◆)
2. **Exposure Summary**: High-level impact one-liner.
3. **Step Log**: Scrolling terminal output (reusing `>` prefix).
4. **Metadata Blocks**: Rigid `[HEADER]` blocks for [VULNERABILITY], [PAYLOAD], [MITIGATION].

## 4. Interaction States
| State | Visual Output |
|-------|---------------|
| **EMPTY** | MISSION CONTROL // NO AUTH DATA LOADED. > Awaiting target identification... |
| **LOADING** | Oscilloscope hex stream (10 lines scrolling) + "> INTERCEPTING PROTOCOL BUFFER..." |
| **ERROR** | Border red flash (500ms). "[FATAL] NETWORK INTERRUPT // {err.msg}" |
| **SUCCESS** | Full ForensicsReadout with verdict and metadata blocks. |
| **PARTIAL** | (In Compare) Populated side vs. "<ZKP BUFFER: NO CHALLENGE LOG IN STORE>". |

## 5. Responsive & Accessibility
### Responsive Breakpoints
*   **≥900px**: 2-column grid (30% Mission Control / 70% Data Stream).
*   **<900px**: Vertical stack. Mission Control becomes sticky top bar with [SELECT ATTACK ▼] dropdown.
*   **<375px**: Single column. Mission Control collapses to a compact icon-driven header.

### Accessibility Rules
*   **Status Indicators**: Use SHAPE + COLOR. ● Circle (Red) = Vulnerable, ◆ Diamond (Green) = Protected.
*   **ARIA**: Attack selector `role="listbox"`, items `role="option"`.
*   **Keyboard**: Arrow keys to navigate, `Enter` to execute, `Esc` to reset.

## 6. Implementation Checklist
- [ ] Define terminal CSS variables and font-family.
- [ ] Implement 30/70 grid with 900px media query.
- [ ] Refactor `AttackSelector` for listbox/dropdown behavior.
- [ ] Update `ForensicsCard` to `ForensicsReadout` (Table/Header format).
- [ ] Add "Oscilloscope" hex noise animation for scanning phase.
- [ ] Implement shape-based status icons (●/◆).

---

## 7. Review Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **D1: Mobile layout** | B — Stacked, sticky top bar | Most usable on small screens; context visible during scroll |
| **D2: Compare results display** | B — CompareCard (card-based) | Dense color-coded per-attack verdict, better than table for 2-system visual scan |
| **D3: Scanning phase warmth** | A — Plain hex noise | Cold forensics aesthetic; `> INTERCEPTING...` text with scrolling hex is authentic protocol analyzer feel |
| **D4: Font loading** | A — Google Fonts `<link>` async | Fast, 1 layout shift; plain mono fallback during load is acceptable |
| **D5: Error flash** | A — Border flash 500ms | Low implementation complexity, high signal-to-noise, consistent with scanline aesthetic |

## 8. Gap Fixes Applied

| Gap | Fix |
|-----|-----|
| Missing mobile breakpoint detail | Added: <900px stacked, <375px compact icon-driven header |
| Missing scanning/loading state | Added: 10-line hex stream + `> INTERCEPTING PROTOCOL BUFFER...` text |
| Missing empty state warmth | Left cold — not a bug, consistent with terminal aesthetic |
| Accessibility: shape + color | Added: ●/◆ status shapes alongside red/green |
| Error recovery direction | Selected border flash (not full red background) |

## 9. Final Ratings

| Pass | Before | After |
|------|--------|-------|
| Info Architecture | 4/10 | 7/10 |
| Interaction States | 2/10 | 8/10 |
| User Journey | 6/10 | 7/10 |
| AI Slop Resistance | 7/10 | 8/10 |
| Design System | 4/10 | 7/10 |
| Responsive/Accessibility | 2/10 | 7/10 |
| **Overall** | **~4/10** | **7.5/10** |

Design review complete. Target for implementation: **8/10**.
