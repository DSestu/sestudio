---
name: sestudio
description: Watch, cast and download from several streaming sites, from one library on your own machine.
colors:
  signal-blue: "oklch(72% 0.16 230)"
  signal-blue-ink: "oklch(18% 0.05 230)"
  ember-coral: "oklch(70% 0.17 25)"
  ember-coral-ink: "oklch(20% 0.06 25)"
  lagoon-teal: "oklch(75% 0.12 180)"
  house-dark: "oklch(16% 0.015 240)"
  aisle-dark: "oklch(20% 0.02 240)"
  row-dark: "oklch(26% 0.025 240)"
  seat-slate: "oklch(30% 0.02 240)"
  screen-white: "oklch(92% 0.01 240)"
  rating-good: "oklch(76% 0.17 155)"
  rating-mixed: "oklch(83% 0.16 85)"
  rating-bad: "oklch(68% 0.19 25)"
  info-blue: "oklch(74% 0.14 250)"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  tab-label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
rounded:
  field: "0.25rem"
  box: "0.5rem"
  selector: "2rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.signal-blue-ink}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 12px"
  button-ghost:
    textColor: "{colors.screen-white}"
    rounded: "{rounded.field}"
    height: "32px"
    padding: "0 12px"
  input-search:
    backgroundColor: "{colors.house-dark}"
    textColor: "{colors.screen-white}"
    rounded: "{rounded.box}"
    height: "56px"
    padding: "0 48px"
  nav-item-active:
    backgroundColor: "{colors.row-dark}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.box}"
    padding: "10px 12px"
  poster-card:
    backgroundColor: "{colors.aisle-dark}"
    rounded: "{rounded.box}"
  chip-rating-good:
    backgroundColor: "{colors.rating-good}"
    textColor: "{colors.house-dark}"
    rounded: "{rounded.selector}"
    padding: "0 8px"
---

# Design System: sestudio

## Overview

**Creative North Star: "The Living-Room Auditorium"**

The interface is the darkened room, and the posters are the lit screen. A near-black, low-chroma navy base steps back so TMDB artwork brings all the color. When you reach for the controls (versions, sources, hosts, cast targets), they are precise, the way an operator's booth is. But the room is a living room, not a cinema: it is used on the couch, at night, phone in hand, so it stays cozy, relaxed and forgiving rather than technical.

Density is comfortable: poster grids and rows carry most screens, with the extra information (VF/VOSTFR availability, source avatars, ratings) kept to small chips at the poster's edges. Motion is soft: one easing curve, short rises and slides, nothing bouncy, and all of it turned off under reduced motion.

**Key Characteristics:**
- Dark-only (`sestudio-dark`): every surface is a step of the same navy-black hue (240).
- Artwork carries color; chrome is near-neutral.
- One Signal Blue accent marks actions, the active place and progress.
- Tonal depth: lightness steps, not shadows.
- Soft, rounded, generous controls; ghost by default.

## Colors

A one-hue dark ramp (navy-black, hue 240, chroma ≤ 0.025) plus one action blue, one warm coral, and a traffic-light trio for ratings.

### Primary
- **Signal Blue** (signal-blue): actions and "you are here". The solid primary button, the active nav item's text, the mobile tab bar's top indicator, unread badges, watch-progress bars, the search field's border and ring. Text on it uses **Signal Blue Ink** (signal-blue-ink).

### Secondary
- **Ember Coral** (ember-coral): the warm accent, used sparingly for emphasis that isn't an action. Shares its hue with the error red, so keep it off destructive contexts. Text on it uses **Ember Coral Ink**.

### Tertiary
- **Lagoon Teal** (lagoon-teal): daisyUI's accent slot; rarely used.

### Neutral
- **House Dark** (house-dark): the page background (`base-100`).
- **Aisle Dark** (aisle-dark): raised surfaces: sidebar (at 40%), tab bar, poster placeholders, panels (`base-200`).
- **Row Dark** (row-dark): borders, dividers, active nav fill, empty-poster fill (`base-300`).
- **Seat Slate** (seat-slate): daisyUI neutral, for neutral buttons and badges.
- **Screen White** (screen-white): all text. Secondary text is Screen White at reduced opacity (50% for subtitles, 40% for tertiary meta), not a different gray.

### Status
- **Rating Good / Mixed / Bad** (rating-good ≥ 7, rating-mixed ≥ 4, rating-bad below): the TMDB-style rating chip. Good is also the success color, Bad the error color, Mixed the warning color.
- **Info Blue** (info-blue): informational alerts.

### Named Rules
**The Art Carries the Color Rule.** Chrome stays on the hue-240 ramp. Saturated color on a screen should come from posters and backdrops, plus Signal Blue on the one thing that is active or actionable.

**The One Hue Ramp Rule.** New surfaces are a step of base-100/200/300 (or one of them at opacity with a backdrop blur), never a new gray or a new tint.

## Typography

**Display Font:** the system UI stack (`ui-sans-serif, system-ui, sans-serif`); no web fonts are loaded.

**Character:** native and unbranded on purpose: it reads like the phone or desktop it runs on, and leaves the personality to the posters. The only exception is the wordmark.

### Hierarchy
- **Headline** (600, 1.25rem to 1.5rem, tight tracking): view titles (Settings, Library, Downloads, a person's name).
- **Title** (600, 1rem to 1.125rem, tight tracking): row and section headings ("Continue watching"), the open title in Watch.
- **Body** (400, 0.875rem): descriptions, lists, settings copy.
- **Label** (500, 0.75rem to 0.875rem): poster titles (truncate to one line), nav items, buttons; subtitles at 50% opacity.
- **Tab label** (500, 11px): the phone's bottom tab bar only.

### Named Rules
**The Tight Heading Rule.** Every heading is semibold with `tracking-tight`; boldness above 600 is kept for the wordmark and the player's overlays.

**The Tabular Time Rule.** Times, counts and positions in the player use tabular numbers so they don't jitter.

## Layout

- **Desktop (`md:` and up):** a sticky left sidebar, 14rem wide (logo, primary nav, Discover catalogues folding under Search, Settings at the bottom), and content capped at `max-w-6xl` (72rem), centred. The Watch view drops the cap and goes full width.
- **Phone (below `md:`):** a 56px sticky top bar (logo, Settings) and a fixed six-tab bottom bar; both clear safe-area insets. Modals become bottom sheets below `sm:` (40rem).
- **Content padding:** 16px on phones, 24px from `sm:`, 32px from `lg:`; 20px vertical.
- **Posters:** always 2:3, in horizontally scrolling rows (no visible scrollbar) or responsive grids.
- **Spacing rhythm:** Tailwind's 4px scale; most gaps are 4, 8, 12 or 20px.

## Elevation & Depth

Depth is tonal first: a surface reads as raised because it is one lightness step up the hue-240 ramp, or because it is a translucent base layer with a backdrop blur over moving content (top bar at 95%, tab bar at 95%, poster overlay controls at 80 to 85%). Shadows appear only on things that float above the page: modals, dropdowns and popovers, the mini-player.

### Named Rules
**The Floating-Only Shadow Rule.** Cards, panels, rows and nav are flat. If it doesn't float over other content, it doesn't get a shadow.

## Shapes

Three radii from the daisyUI theme: fields and buttons are gently rounded (`rounded.field`), boxes, cards, posters and nav items are a little rounder (`rounded.box`), and selectors (badges, toggles, chips) are pills (`rounded.selector`). Circular controls (play over a poster, cast) use `rounded-full`. Borders are 1px in Row Dark; the search field is the one 2px border.

## Components

### Buttons
Soft and forgiving: ghost by default, one solid Signal Blue primary per area.
- **Shape:** gently rounded (`rounded.field`); square and circle variants for icon buttons.
- **Primary:** Signal Blue fill, Signal Blue Ink text; `btn-sm` (32px) is the common size.
- **Ghost:** transparent until hover; the default for toolbars, rows and icon actions. An active ghost (current view) adds `btn-active` and Signal Blue text.
- **Destructive:** ghost at 40% opacity that turns error-red on hover, or `btn-error` inside a confirm.

### Chips
- **Rating chip:** a pill in the rating's traffic-light color, "★ 7.4", 500 weight, no border, pinned to a poster's top-right corner. Renders nothing for unrated titles.
- **Count badges:** Signal Blue pills on nav items and tabs.
- **Tinted badges:** status at 15% fill with full-strength text (for example "Finds" in success green).

### Cards / Containers
- **Poster card:** a 2:3 image in a `rounded.box` frame on Aisle Dark with a 1px ring; the title (label, one line) and a 50% subtitle sit below, outside the frame. On hover-capable devices a 40% House Dark veil fades in with a circular Signal Blue play button. Watch progress is a 4px Signal Blue bar along the bottom edge. Overlays (rating, source avatar, selection box) sit in the corners at 6px insets.
- **Panels:** Aisle Dark or a base layer at opacity, `rounded.box`, flat.

### Inputs / Fields
- **Search field:** the signature input. 48px on phones, 56px from `sm:`, `rounded.box`, a 2px Signal Blue border at 80% with a 4px Signal Blue ring at 15%, a Signal Blue magnifier at the left and a spinner at the right while searching.
- **Other fields:** daisyUI defaults on the theme (`rounded.field`, 1px border).

### Navigation
- **Sidebar item:** 14px medium label with an icon, `rounded.box`, 10px by 12px padding; the active item gets a Row Dark fill and Signal Blue text, others are 70% text that brightens on hover.
- **Tab bar (phone):** six equal tabs, icon over an 11px label, minimum 56px tall; the active tab is Signal Blue with a 2px by 32px pill indicator at its top edge.

### Player
Vidstack-based. It morphs between the full pane and the mini-player with a View Transition (250ms); its overlay type is bold white with tabular numbers.

## Do's and Don'ts

### Do:
- **Do** keep every surface on the hue-240 ramp (house-dark, aisle-dark, row-dark) and let artwork bring the color.
- **Do** use Signal Blue for the single active or primary thing in a region: the current nav item, the main action, progress.
- **Do** use `ease-smooth` (`cubic-bezier(.2, .8, .2, 1)`) and the `rise` (320ms) or `slide` (240ms) animations for arriving content, and disable motion under `prefers-reduced-motion`.
- **Do** keep tap targets generous: 56px tab bar cells, 32px minimum buttons, padded nav rows.
- **Do** design both layouts: the desktop sidebar and the phone's top bar, tab bar and bottom sheets.

### Don't:
- **Don't** add a light theme or bright surfaces; the app is used in a dim room.
- **Don't** put shadows on cards, rows or panels; shadows are only for floating layers.
- **Don't** introduce web fonts or a second accent hue for chrome.
- **Don't** use Ember Coral next to destructive actions; it shares the error hue.
- **Don't** hide missing versions: show the gap (struck through or listed) instead of leaving it out.
