---
name: Glacier Signal Ticket System
description: A traceable trading verdict issued as a clipped paper ticket and carbon-copy risk receipt.
colors:
  carrier-navy: "#0d1b3d"
  carrier-navy-soft: "#172a55"
  coupon-paper: "#f7f4ed"
  check-stock: "#ebe6dc"
  desk-stock: "#e9e6df"
  validation-red: "#bd2d37"
  validation-red-deep: "#8f1f29"
  carbon-purple: "#d8c9e8"
  carbon-purple-ink: "#39256f"
  verified-green: "#246d59"
  pending-amber: "#a46816"
  ticket-ink: "#111a2d"
  ticket-muted: "#647087"
  header-night: "#07142f"
  coupon-white: "#fffdf7"
typography:
  display:
    fontFamily: '"DIN Condensed", "Avenir Next Condensed", "Arial Narrow", sans-serif'
    fontSize: "clamp(68px, 9vw, 118px)"
    fontWeight: 800
    lineHeight: 0.78
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Avenir Next", Avenir, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "clamp(36px, 5vw, 74px)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  title:
    fontFamily: '"Avenir Next", Avenir, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 850
    lineHeight: 1.35
    letterSpacing: "0.02em"
  body:
    fontFamily: '"Avenir Next", Avenir, "SF Pro Display", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '"Avenir Next", Avenir, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 750
    lineHeight: 1.5
    letterSpacing: "0.08em"
rounded:
  circle: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  compact: "10px"
  md: "14px"
  lg: "18px"
  xl: "22px"
  xxl: "24px"
components:
  button-validation:
    backgroundColor: "{colors.validation-red}"
    textColor: "{colors.coupon-white}"
    padding: "0 22px"
    height: "40px"
  button-validation-hover:
    backgroundColor: "{colors.validation-red-deep}"
    textColor: "{colors.coupon-white}"
  button-risk:
    backgroundColor: "{colors.carbon-purple-ink}"
    textColor: "{colors.coupon-white}"
    padding: "0 22px"
    height: "40px"
  input-ticket:
    backgroundColor: "transparent"
    textColor: "{colors.carrier-navy}"
    height: "34px"
  coupon-verdict:
    backgroundColor: "{colors.coupon-paper}"
    textColor: "{colors.ticket-ink}"
    padding: "clamp(24px, 4vw, 50px)"
  coupon-risk:
    backgroundColor: "{colors.carbon-purple}"
    textColor: "{colors.carbon-purple-ink}"
    padding: "24px 22px"
---

# Design System: Glacier Signal Ticket System

## Overview

**Creative North Star: "The Traceable Verdict Ticket"**

Glacier Signal turns a stock evaluation into an issued trading document: carrier navy holds the set, paper-white coupons carry the verdict, and a carbon-purple receipt records risk and position outputs. The mood is procedural, restrained, and accountable. Every result should feel stamped, attached, and auditable rather than summarized in a generic analytics dashboard.

The system favors dense but ordered information, visible provenance, and state changes that leave a legible trace. Paper grain, ruled lines, perforations, clipped corners, carbon numerals, and validation marks provide character without weakening Chinese body-text clarity. Red marks action, failure, pending issuance, and cancellation; green is reserved for completed validation.

**Key Characteristics:**

- Ticket-book composition held by deep carrier navy
- Warm paper coupons and a distinct carbon-copy risk surface
- Clipped corners, dashed tears, perforation holes, and ruled rows
- Condensed, tabular numerals for scores, prices, and codes
- Explicit pass, fail, and pending words or symbols alongside color
- Verdict-first hierarchy with risk output visibly attached

## Colors

The palette behaves like printed operational stationery: dark navy structure, warm paper, purple carbon copy, and scarce validation inks.

### Primary

- **Carrier Navy:** The enclosing wallet, section headers, brand data, and high-authority structure.
- **Carrier Navy Soft:** A secondary dark layer for navy-on-navy depth where the carrier needs separation.

### Secondary

- **Carbon Purple:** The risk receipt stock; use it only where account risk, stop, or position output is being issued.
- **Carbon Purple Ink:** Numerals, fields, and actions that belong to the risk receipt.

### Tertiary

- **Validation Red:** The primary signing action, failed or void state, selected confirmation, and validation stamp.
- **Validation Red Deep:** Hover state and long-form error copy that needs stronger contrast.
- **Verified Green:** Passed checks and a successfully issued validation stamp.
- **Pending Amber:** Incomplete or indeterminate checks; it must always be paired with a pending symbol or label.

### Neutral

- **Coupon Paper:** The master verdict and score-detail stock.
- **Check Stock:** The slightly darker automatic-check and supplementary coupon stock.
- **Desk Stock:** The neutral surface below the navy ticket holder.
- **Ticket Ink:** Primary Chinese copy on light tickets.
- **Ticket Muted:** Supporting explanations, provenance, labels, and disclaimers.
- **Coupon White:** High-contrast display copy on dark carriers and actions.
- **Header Night:** The route-specific application header above the ticket set.

### Named Rules

**The Carbon Boundary Rule.** Carbon purple belongs to risk, stop, position, and their attached action; do not spread it across ordinary content.

**The Ink Has Meaning Rule.** Red, green, and amber are operational states, not decorative accents, and color never stands alone.

## Typography

**Display Font:** DIN Condensed (with Avenir Next Condensed and Arial Narrow fallbacks)

**Body Font:** Avenir Next (with PingFang SC, Microsoft YaHei, and system sans-serif fallbacks)
**Label/Mono Font:** The condensed display stack with tabular numerals for codes and quantitative output

**Character:** Narrow Latin and large tabular figures evoke issued tickets and machine-set receipts. Chinese text stays in a highly legible sans-serif, with weight and spacing—not imitation condensed glyphs—carrying hierarchy.

### Hierarchy

- **Display** (800, fluid oversized scale, 0.78 line-height): Candidate score and other singular, dominant machine-read values.
- **Headline** (800, fluid large scale, 0.96 line-height): Stock name, decisive verdicts, and empty or error-state statements.
- **Title** (850, compact scale, 1.35 line-height): Coupon, receipt, module, and section headings.
- **Body** (400, compact scale, 1.55 line-height): Explanations and operating guidance, generally kept within a readable 620–720px measure.
- **Label** (750, small scale, 0.08em letter-spacing): Field names, metadata, and uppercase-like ticket annotations.

### Named Rules

**The Numerical Authority Rule.** Prices, scores, dates, codes, shares, and percentages use tabular numerals; the largest type is reserved for the one value that decides the current step.

## Layout

The outer shell is centered and capped at 1500px, with compact page gutters and generous bottom clearance. The desktop ticket holder is a three-part grid: a narrow check strip, a dominant verdict coupon, and a risk receipt. At 1100px the verdict spans the first row while checks and receipt share the second. At 760px the set becomes a single column in verdict, checks, receipt order; below 420px, headers, score blocks, and three-up price data collapse further. Horizontal overflow is clipped and every grid child permits shrinking.

Spacing uses a compact 6–24px rhythm inside operational controls and coupon rows, while the master verdict may expand to 50px padding. Dashed separators organize dense content without introducing independent cards. Score modules and supplementary conditions continue as full-width detachable strips below the primary ticket set.

**The Attached Sequence Rule.** Responsive changes may reorder and compress coupons, but they must preserve the task sequence and the visual sense that checks, verdict, and risk receipt belong to one issued set.

## Elevation & Depth

Depth is mostly structural: navy carrier behind paper, tonal stock changes, one-pixel borders, dashed tears, ruled textures, and clipped silhouettes. Shadows are low, wide, and heavily negative-spread, used to seat the search ticket, carrier, and coupons rather than make them float like app cards.

### Shadow Vocabulary

- **Search Seat** (`0 18px 32px -28px rgba(13, 27, 61, 0.8)`): A restrained shadow beneath the standalone search ticket.
- **Carrier Seat** (`0 26px 60px -36px rgba(4, 13, 35, 0.95)`): The deepest shadow, reserved for the navy ticket holder.
- **Coupon Seat** (`0 22px 44px -34px rgba(5, 15, 38, 0.9)`): A narrow separation between paper and its carrier.

**The Printed-First Rule.** Texture, borders, and overlapping stock establish depth before shadow; never turn coupons into glossy floating cards.

## Shapes

Primary surfaces and actions use clipped octagonal corners, generally cutting 8–14px from each corner. Detachable relationships use dashed borders and repeated semicircular perforation holes. Circular geometry is limited to 18px status marks and native choice controls. The system avoids soft card radii on the evaluation surface; its silhouette is cut paper, not a rounded software panel.

**The Cut, Do Not Round Rule.** Use clipped corners for tickets, buttons, headers, and coupons; reserve true circles for compact status or selection marks.

## Components

### Buttons

- **Shape:** Clipped ticket geometry with 8px corner cuts; no rounded capsule.
- **Primary:** Validation red with white copy, a 40px minimum height, and firm 800 weight.
- **Hover / Focus:** Hover deepens to validation red deep; keyboard focus uses a 3px translucent red outline with 3px offset.
- **Risk Action:** Carbon-purple ink on the purple receipt, full width when it issues the attached backtest action.

### Cards / Containers

- **Corner Style:** Clipped paper with 8–14px cuts, sometimes joined by dashed tear edges.
- **Background:** Coupon paper for verdict and detail, check stock for validation lists, carbon purple for risk output, and carrier navy beneath the set.
- **Shadow Strategy:** Use the restrained seating shadows defined above.
- **Border:** One-pixel navy or purple ink at translucent strength; dashed lines express internal rules and detachable seams.
- **Internal Padding:** 18–24px for standard coupons; the master verdict expands fluidly from 24px to 50px.

### Inputs / Fields

- **Style:** Transparent, borderless input sitting on a single ink-colored bottom rule; values use strong tabular numerals.
- **Focus:** The field or containing choice receives the shared red focus outline; the input does not introduce a rounded inset box.
- **Error / Disabled:** Error copy uses deep validation red; unavailable calculated output shows an em dash rather than fabricated data.

### Navigation

The evaluation route uses a translucent header-night bar with square-edged links and inputs. Active navigation receives a faint white fill and hairline border; inactive items stay muted blue-gray until hover. On mobile, the menu becomes a full-width dark continuation below the 68px header and the search action switches to validation red.

### Validation Stamp

A double-line red stamp, slightly rotated, carries the explicit pending or void wording. Successful issuance changes the ink to verified green and uses a slightly calmer rotation. Its entrance is a single 480ms stamp impression and is suppressed by reduced-motion preferences.

### Status Rows and Confirmations

Automatic checks use an 18px outlined circle containing a check, cross, or pending mark plus a written state. User choices are rectangular ruled rows with at least 42px height; selection adds a red border and a light red wash while preserving consequence copy.

### Score Disclosure Coupon

Expandable score modules remain flat paper strips. The summary aligns module identity, reason, score, and a plus/minus mark; opening rotates only the vertical stroke over 160ms and reveals a dashed-top detail region.

## Do's and Don'ts

### Do:

- **Do** lead with the current verdict and any blocking condition before score detail.
- **Do** preserve the carrier, coupon, carbon-copy, perforation, and validation-mark vocabulary across screen sizes.
- **Do** pair red, green, and amber with text or a distinct symbol.
- **Do** keep quantitative values tabular and keep risk output on carbon purple.
- **Do** honor reduced-motion preferences and maintain visible keyboard focus.

### Don't:

- **Don't** reinterpret the evaluation as a grid of interchangeable rounded metric cards.
- **Don't** use purple as a general accent outside the risk receipt and its quantitative links.
- **Don't** let a score visually erase a failed, void, or pending condition.
- **Don't** detach the backtest action from the risk receipt.
- **Don't** compress mobile into a horizontal rail or allow horizontal scrolling.
