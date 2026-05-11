# Product

## Register

product (educational demo tool)

## Users

Teachers and students evaluating AI agent authentication patterns. Users are likely familiar with basic auth concepts but exploring advanced topics (ZKP, OAuth2 PKJWT). They want to understand HOW each auth flow works, not just see it work.

## Product Purpose

Demo two independent authentication systems side-by-side: OAuth2 PKJWT (per-agent RS256 signing) vs ZKP Schnorr (server never sees secret). The UI teaches through visualization — action log, computation sidebar, attack simulation — not through documentation alone.

Success looks like: a teacher can demo this in 10 minutes and students immediately grasp WHY ZKP is theoretically stronger than OAuth2 for identity correlation.

## Brand Personality

Confident + approachable. Technical enough to earn respect from devs, approachable enough that non-experts can follow along. Like Stripe's docs — complex topics made feel manageable.

3-word personality: **clear · credible · curious**

## Anti-references

- No neon-on-black hacker aesthetic — this is a course demo, not a CTF
- No corporate blueenterprise SaaS grids — it's educational, not a sales tool
- No heavy dark mode — light theme works better in classroom/projector settings
- No decorative gradients or glassmorphism

## Design Principles

1. **Explain by showing, not telling** — animations and the action log make the invisible visible (token flow, proof computation). No paragraph dumps.
2. **Trust the audience** — students can handle technical detail (JWT headers, modular math callouts). Don't oversimplify to the point of being wrong.
3. **Comparison is the product** — the ZKP vs OAuth2 split should always be visually balanced. No "ZKP is the hero, OAuth2 is the villain." Both are presented with equal technical honesty.
4. **Calm focus** — no flashy transitions, no celebration animations on success. The "wow" comes from insight, not from fireworks.

## Accessibility & Inclusion

- WCAG AA target
- Reduced motion respected (prefers-reduced-motion already in CSS)
- Color is informational, not structural — ZKP/OAuth2 distinction uses icons + text labels alongside color
- High-contrast text on all surfaces (≥4.5:1 on backgrounds)