# ZayedMart Design System — Tactile Retail Command

## Aesthetic Direction
**Tactile Retail Command** merges Material 3 Expressive geometry with high-contrast, glare-resistant operational surfaces designed for floor staff using phones one-handed in a busy supermarket.

## Tokens & Typography (`apps/web/src/index.css`)
- **Surface Hierarchy**:
  - `--g-bg`: app canvas background
  - `--g-surface`, `--g-surface-2`, `--g-surface-variant`, `--g-surface-tint`: layered card and control surfaces
  - `--g-border`: subtle divider stroke
- **Semantic Accents**:
  - `--g-primary`, `--g-primary-solid`, `--g-primary-container`, `--g-on-primary-container`
  - Status families (`--g-green*`, `--g-yellow*`, `--g-red*`, `--g-purple*`)
- **Typography & Numerals**:
  - Selectable Arabic UI fonts (`cairo`, `tajawal`, `readex`) + scalable root sizing (`fontScale`)
  - `.num-ltr` enforces tabular left-to-right alignment on clocks, counts, and timestamps
  - `.ms-icon` uses Material Symbols Rounded/Outlined across all UI controls (no emoji UI icons)
- **Performance & Accessibility Modes**:
  - `.lite-mode` disables heavy blur/animations on budget Android handsets
  - `prefers-reduced-motion` respected globally

## Mobile Thumb-Zone Architecture
- **Slim 1-Row `TopBar`**: ~56px compact header on mobile; secondary controls (theme, lite mode, typography, kiosk lock, handover, QR, logout) live in a Quick Settings & Profile `BottomSheet`.
- **Capped `BottomNav`**: Maximum 5 slots on mobile (`<= 48px` min target); overflows into an aggregated **"المزيد / الإدارة"** `BottomSheet` with unread badges and quick actions.
- **Context-Aware `SmartFab`**: Anchored on the right (`right-3 sm:right-6`, `bottom-21 md:bottom-6`) opposite `WalkieFloatingDock` on the left (`left-3 sm:left-6`) so the two docks never collide. Dispatches context primary actions (`shortage_add`, `qr_scan`, `truck_arrive`, `note_add`) and a speed-dial for cross-tab actions.
- **Snap `BottomSheet` Composers**: Heavy forms (`ShortageComposerForm`, `NoteComposerForm`) open inside thumb-reachable snap sheets on mobile while staying inline on desktop.

## Component Catalog (`apps/web/src/components/ui/`)
- `Button`, `Badge`, `Card`, `StatCard`
- `BottomSheet`
- `FilterChipRail`, `SearchFilterBar`
- `EmptyState`
- `SkeletonKpiStrip`, `SkeletonList`
- `SmartFab`
