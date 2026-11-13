# ZayedMart Operations Platform — Product Overview

ZayedMart is an internal Arabic-first (RTL) supermarket operations platform built with a React + Vite PWA/Capacitor Android frontend (`apps/web`) and a NestJS + PostgreSQL/SQLite backend (`apps/api`), sharing RBAC permissions and utilities via `packages/shared`.

## Core Workflows
1. **Attendance & QR Dispatch (`attendance`)**: Staff check-in/out, shift statuses, employee log inspection, and QR/PIN kiosk mode (`KioskLockView`, `QrQuickModal`).
2. **Shortages & Quick Catalog (`shortages`)**: Rapid shelf-shortage reporting and cashier product suggestions, category pills, quick-tap catalog items, nullable/0/positive quantity selection, voice-to-text, and WhatsApp/CSV/Word export (`ShortagesView`, `ShortageComposerForm`).
3. **Supplier Trucks & Unload Timers (`trucks`)**: Track supplier arrivals, live unload timers, invoices, return/damage alerts, and departure completion (`TrucksView`).
4. **CCTV Notes & Shift Handovers (`notes`)**: Location/category chip logging, urgency flags, voice dictation, image proofs, and shift handover tracking (`CctvNotesView`, `NoteComposerForm`).
5. **Team Chat & Walkie-Talkie (`chat` + `WalkieFloatingDock`)**: Real-time staff messaging and push-to-talk audio dispatch.
6. **Administration Dashboard (`dashboard`)**: Staff/users, suppliers, audit logs, reports, settings, and backups (`AdminDashboard`).

## Offline-First & Low-Bandwidth Sync
- **Digest Check (`GET /api/sync-check`)**: Background 15-second polls query only the lightweight digest first via `fetchBootstrapIfNeeded` and skip downloading full payloads when `mutationSeq` and `lastMutationAt` are unchanged.
- **Idempotent Offline Queue**: Client-generated UUIDs prevent duplicate records during offline replay, with a poison-pill cap (`retryCount > 5`) in `flushOfflineQueue`.
