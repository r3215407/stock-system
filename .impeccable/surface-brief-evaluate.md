# Evaluate surface brief

- Scope: `app/evaluate/page.tsx`, `components/EvaluationWorkspace.tsx`, and route-scoped presentation helpers.
- Mode: Operate.
- Audience and job: an individual A-share trend trader checks one symbol after market close and needs to decide whether it is executable, then obtain stop and position guidance.
- Primary action: complete the two user confirmations, understand any blocking condition, then use the resulting position plan or inspect the two-year backtest.
- Product constraints: preserve all existing market-data, hard-filter, scoring, position-sizing, error, empty, and backtest behavior; never present score as probability; mobile must not scroll horizontally.
- Chosen world: jet-age ticket wallet. Carrier navy and coupon white organize the work; carbon purple is reserved for risk output; red validation marks failure, pending, cancellation, and primary action. Perforations, clipped coupon corners, carbon numerals, and retained VOID states carry the identity.
- Approved composition: `.impeccable/mocks/ticket-verdict.png` — verdict-first master coupon, detachable automated/user-check strip at left, carbon-copy risk receipt at right, scoring coupons below.
- Memorable moment: changing a user confirmation visibly re-stamps the release coupon and updates the attached risk receipt without removing the traceable failed or pending row.

## Composition inventory

| Visible ingredient | Commitment | Implementation medium |
|---|---|---|
| Verdict master coupon | Dominates first viewport; stock, date, conclusion, score and validation stamp read as one object | Semantic HTML + CSS |
| Hard-filter/check strip | Compact detachable strip; automatic rows and both user confirmations remain visible | Semantic fieldsets + CSS |
| Risk receipt | Carbon-purple paper, stop and position output, backtest action; stacks after verdict on mobile | Semantic HTML + CSS |
| Coupon edges | Clipped corners and semicircular perforations, no generic rounded cards | CSS masks/gradients and pseudo-elements |
| Validation stamp | Red outlined pending/fail mark, green validated mark; words and symbol accompany color | Semantic text + CSS transform |
| Score-detail coupons | Full-width quiet strips below first viewport; expandable details preserve current behavior | Native `details` + CSS |
| Type | Narrow Latin display voice for brand/data; Chinese stays highly legible; tabular numerals throughout | `next/font` + CSS font stacks |
| Material | Subtle coupon fiber and carbon-copy texture, visible but never behind core body text at harmful contrast | CSS texture layers |
| Primary action | Backtest button belongs to the purple receipt and uses clipped ticket geometry | Semantic link + CSS |

## Responsive contract

- Desktop: three-part first viewport — check strip, verdict coupon, risk receipt.
- Tablet: verdict coupon spans first row; checks and receipt share the second row.
- Mobile: one vertical ticket book in task order — stock/verdict, blocking checks and confirmations, risk receipt, score details. No horizontal rail or horizontal scrolling.
- Ticket geometry, type hierarchy, state vocabulary, and materials remain intact at every breakpoint; adaptation changes order and density, not identity.
