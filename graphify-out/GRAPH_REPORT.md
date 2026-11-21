# Graph Report - ZayedMart  (2026-11-21)

## Corpus Check
- 164 files · ~261,549 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 38 file(s) not represented in the graph (top: .xml 10, .ttf 7, (none) 4)

## Summary
- 2608 nodes · 6453 edges · 127 communities (96 shown, 31 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 355 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c9c3f9b0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- live-browser.js
- resumeSession
- useWalkieTalkie.js
- setLiveState
- App.jsx
- core.py
- modern-screenshot.umd.js
- api.js
- el
- initPageChat
- apiRequest
- MainActivity.java
- playSuccessChime
- app.module.ts
- api/package.json
- exportUtils.js
- AttendanceView.jsx
- UI/UX Pro Max - Design Intelligence
- .respondToSwap
- initGlobalBar
- bootstrap.module.ts
- RequirePermission
- AttendanceView
- localDb.js
- .execute
- AuthContext
- Frontend Design (Distinctive, Production-Grade)
- documentRefForElement
- rbac.ts
- mountSvelteComponentVariant
- new-work.md
- DatabaseService
- utils.ts
- Responsive Design
- package.json
- live.md
- document.md
- handleManualEditActivity
- RequireAnyPermission
- web/package.json
- with
- onboard.md
- CurrentAuth
- ShortagesView
- impeccable/SKILL.md
- The Toolkit
- getClientIp
- compilerOptions
- database.service.ts
- createLiveBrowserSessionState
- .quickScan
- useWalkieTalkie.js
- shared/package.json
- onAnnotDown
- resolveLiveInjectionAnchor
- animate.md
- Handle `generate`
- createLiveBrowserDomHelpers
- tasks
- .bulkCreateEmployees
- React/React Native Component Scaffolding
- Generate Report
- New visual work
- optimize.md
- ExampleInstrumentedTest.java
- .createMessage
- compilerOptions
- compilerOptions
- critique.md
- Simplify the Design
- Hardening Dimensions
- clarify.md
- Nielsen's 10 Heuristics
- Generate Combined Critique Report
- polish.md
- quieter.md
- api.e2e.test.mjs
- app.factory.ts
- Init flow
- document.md
- colorize.md
- Common Cognitive Load Violations
- iOS platform
- bolder.md
- Shape
- vercel.json
- PermissionsGuard
- RealtimeModule
- adapt.native.md
- Android platform
- Persona-Based Design Testing
- Extract Flow
- Generate Report
- Cognitive Load Assessment
- Impeccable Asset Producer
- Impeccable Finish Reviewer
- Impeccable Manual Edit Applier
- live-browser-ignores.js
- nest-cli.json
- ZayedMart Design System — Tactile Retail Command
- Visualize: Direction Comps & Asset Production
- AuthGuard
- interface
- Impeccable Documenter
- Heuristics Scoring Guide
- sw.js

## God Nodes (most connected - your core abstractions)
1. `AuthContext` - 89 edges
2. `apiRequest()` - 85 edges
3. `CurrentAuth` - 74 edges
4. `DatabaseService` - 72 edges
5. `RequirePermission()` - 61 edges
6. `getClientIp()` - 55 edges
7. `playSuccessChime()` - 48 edges
8. `App()` - 48 edges
9. `react` - 39 edges
10. `AdminDashboard()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `fetchWeeklySchedule()` --calls--> `getSaturdayWeekStart()`  [EXTRACTED]
  apps/web/src/lib/api.js → packages/shared/src/utils.ts
- `loginWithPassword()` --calls--> `inferDefaultRoleFromDepartment()`  [EXTRACTED]
  apps/web/src/lib/api.js → packages/shared/src/rbac.ts
- `Offline-First & Low-Bandwidth Sync` --references--> `fetchBootstrapIfNeeded()`  [INFERRED]
  apps/web/PRODUCT.md → apps/web/src/lib/api.js
- `Offline-First & Low-Bandwidth Sync` --references--> `flushOfflineQueue()`  [INFERRED]
  apps/web/PRODUCT.md → apps/web/src/lib/api.js
- `SseClientEntry` --references--> `AuthContext`  [EXTRACTED]
  apps/api/src/realtime/realtime.service.ts → apps/api/src/common/decorators.ts

## Import Cycles
- None detected.

## Communities (127 total, 31 thin omitted)

### Community 0 - "live-browser.js"
Cohesion: 0.03
Nodes (134): addManualContextText(), applyGlobalBarLabelState(), applyParamValue(), applyPlaceholderSizingStyles(), averageRgb01(), bindEditBadgeProxy(), bufferToBase64(), buildCollapsible() (+126 more)

### Community 1 - "resumeSession"
Cohesion: 0.06
Nodes (81): applyParamDefaults(), applyPlaceholderDimensions(), applySavedSessionMeta(), clampVariantIndex(), clearHandled(), closedClipPath(), commitAcceptedVariantToDom(), completeParameterGenerationIfReady() (+73 more)

### Community 2 - "useWalkieTalkie.js"
Cohesion: 0.11
Nodes (53): createBackgroundHeartbeatWorker(), createLiveRadioRoomEngine(), cleanupPeer(), emitMeshSummary(), ensurePeerConnection(), flushCompletedSpeechBurst(), handleIncomingAudioFrame8k(), handleIncomingAudioMeter() (+45 more)

### Community 3 - "setLiveState"
Cohesion: 0.10
Nodes (65): abandonForeignSession(), abortSvelteComponentInjection(), applyEditing(), beginNewLiveConfiguration(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure(), cleanup() (+57 more)

### Community 4 - "App.jsx"
Cohesion: 0.06
Nodes (38): App(), handleLockToKiosk(), handleLogout(), getPreferredAllowedTab(), getTodayLocalKey(), BottomNav(), CHANNELS, QUICK_CASHIER_ALERTS (+30 more)

### Community 5 - "core.py"
Cohesion: 0.05
Nodes (11): BM25, detect_domain(), _load_csv(), search(), _search_csv(), search_stack(), DesignSystemGenerator, format_ascii_box() (+3 more)

### Community 6 - "modern-screenshot.umd.js"
Cohesion: 0.09
Nodes (53): ae(), be(), bt(), Ce(), Ct(), de(), dt(), _e() (+45 more)

### Community 7 - "api.js"
Cohesion: 0.10
Nodes (53): Core Workflows, Offline-First & Low-Bandwidth Sync, ZayedMart Operations Platform — Product Overview, AuthLoginScreen(), handleSubmit(), ALL_PERMISSION_IDS, authInvalidListeners, buildHeaders() (+45 more)

### Community 8 - "el"
Cohesion: 0.08
Nodes (54): actionLabel(), applyConfigureBarChrome(), bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), bindConfigureModifierPillHover(), buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow() (+46 more)

### Community 9 - "initPageChat"
Cohesion: 0.07
Nodes (54): agentHasWorkInFlight(), armPageChatForTyping(), attachSteerFocusDebug(), attachSteerFocusGuard(), buildSteerProcessingDots(), buildSteerQueueHint(), clearSteerAwaitTimer(), clearSteerFocusRecoverTimer() (+46 more)

### Community 10 - "apiRequest"
Cohesion: 0.06
Nodes (46): AdminDashboard(), handleAddEmployee(), handleAddSupplier(), handleBulkAddEmployees(), handleBulkAddSuppliers(), handleClearOperationalLogs(), handleCopyWhatsAppOnly(), handleDeleteEmployee() (+38 more)

### Community 11 - "MainActivity.java"
Cohesion: 0.05
Nodes (18): MainActivity, ZayedAndroidBridge, background_color, categories, description, dir, display, display_override (+10 more)

### Community 12 - "playSuccessChime"
Cohesion: 0.10
Nodes (31): formatShortDate(), getInitials(), GROUP_STYLE_BY_TONE, ScheduleView(), handleAssignDayOff(), handleBulkActionConfirm(), handleCancelSwap(), handleRevertSwap() (+23 more)

### Community 13 - "app.module.ts"
Cohesion: 0.12
Nodes (21): AttendanceModule, AuthModule, ChatModule, createLoginRateLimiter(), decryptPasswordForAdmin(), ANY_PERMISSIONS_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY (+13 more)

### Community 14 - "api/package.json"
Cohesion: 0.06
Nodes (43): dependencies, cors@^2.8.5, dotenv@^16.4.7, express@^4.21.2, @nestjs/common@^11.0.11, @nestjs/core@^11.0.11, @nestjs/platform-express@^11.0.11, pg@^8.13.3 (+35 more)

### Community 15 - "exportUtils.js"
Cohesion: 0.12
Nodes (41): AdminReportsPanel(), applyPreset(), shiftDateKey(), PersonLogModal(), load(), ProfileModal(), load(), AVATAR_COLORS (+33 more)

### Community 16 - "AttendanceView.jsx"
Cohesion: 0.11
Nodes (26): ACTION_META, BREAK_PRESETS, BREAK_REASONS, CALL_ALLOWED_ROLES, DEPT_ICONS, QUICK_ATTENDANCE_NOTES, CATEGORY_TAGS, LOCATION_TAGS (+18 more)

### Community 17 - "UI/UX Pro Max - Design Intelligence"
Cohesion: 0.05
Nodes (42): 1. Accessibility (CRITICAL), 2. Touch & Interaction (CRITICAL), 3. Performance (HIGH), 4. Layout & Responsive (HIGH), 5. Typography & Color (MEDIUM), 6. Animation (MEDIUM), 7. Style Selection (MEDIUM), 8. Charts & Data (LOW) (+34 more)

### Community 19 - "initGlobalBar"
Cohesion: 0.09
Nodes (38): agentStatusText(), barPaletteForTheme(), brandMarkSvg(), buildDesignHeader(), buildParamsPanel(), designPanelCss(), detectPageTheme(), ensureAgentPollTooltip() (+30 more)

### Community 20 - "bootstrap.module.ts"
Cohesion: 0.06
Nodes (23): BootstrapModule, validateImageMagicBytes(), DatabaseModule, StorageService, androidDir, androidHome, apkSource, __dirname (+15 more)

### Community 21 - "RequirePermission"
Cohesion: 0.17
Nodes (3): RequirePermission(), NotesController, TrucksController

### Community 22 - "AttendanceView"
Cohesion: 0.09
Nodes (29): AttendanceView(), canActOnEmployee(), handleDeleteAttendanceLog(), handleQuickCardAction(), handleSaveEditedLog(), handleVerifyLog(), isOwnEmployeeRecord(), openEmployeeModal() (+21 more)

### Community 23 - "localDb.js"
Cohesion: 0.12
Nodes (29): PwaInstallBanner(), handleInstallClick(), getOfflineQueue(), enqueueOutboxMutation(), ensurePersistentStorage(), getOutboxSyncMirror(), getPwaInstallState(), idbClearAndPutAll() (+21 more)

### Community 26 - "Frontend Design (Distinctive, Production-Grade)"
Cohesion: 0.06
Nodes (31): 10. Questions to Ask (If Needed), 1. Core Design Mandate, 1. Design Direction Summary, 1. Purpose, 2. Design Feasibility & Impact Index (DFII), 2. Design System Snapshot, 2. Tone (Choose One Dominant Direction), 3. Differentiation Anchor (+23 more)

### Community 27 - "documentRefForElement"
Cohesion: 0.08
Nodes (32): canRestoreManualEditElement(), collectEditableTextRows(), visit(), walk(), copyEditContainerContext(), copyEditLeafContext(), cssIdent(), directMixedTextRestoreNodes() (+24 more)

### Community 28 - "rbac.ts"
Cohesion: 0.13
Nodes (13): ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, getPrimaryWalkieChannelForRole(), PermissionItem, resolveAllowedWalkieChannels(), RoleMetadata, SCHEDULE_TEAM_GROUP_IDS, SCHEDULE_TEAM_GROUPS (+5 more)

### Community 29 - "mountSvelteComponentVariant"
Cohesion: 0.10
Nodes (30): acceptedDomAlreadyClean(), applyOriginalAttrsToSvelteAnchor(), captureAndEmit(), checkpointPayload(), clearHandledWrapperReloadStamp(), commitAcceptedSvelteComponentToDom(), componentModuleCandidates(), deferredRecoverySuperseded() (+22 more)

### Community 30 - "new-work.md"
Cohesion: 0.07
Nodes (27): 1. Accessibility (VoiceOver / TalkBack), 2. Performance, 3. Appearance & Theming, 4. Platform Conformance (CRITICAL), 5. Adaptivity, Diagnostic Scan, Recommended Actions, Craft (deprecated alias) (+19 more)

### Community 31 - "DatabaseService"
Cohesion: 0.09
Nodes (5): deterministicSaltHex(), encryptPasswordForAdmin(), hashPin(), convertPlaceholdersToPg(), DatabaseService

### Community 32 - "utils.ts"
Cohesion: 0.15
Nodes (19): addDaysToDateKey(), computeShiftDurationHours(), evaluateNextCheckInAvailability(), formatShiftDurationArabic(), formatShiftSummaryArabic(), getLocalDateKey(), getLocalTimeHMS(), getNextDateKey() (+11 more)

### Community 33 - "Responsive Design"
Cohesion: 0.08
Nodes (25): Assess Adaptation Challenge, Breakpoints: Content-Driven, Content Adaptation, Desktop Adaptation (Mobile → Desktop), Detect Input Method, Not Just Screen Size, Email Adaptation (Web → Email), Implement Adaptations, Layout Adaptation Patterns (+17 more)

### Community 34 - "package.json"
Cohesion: 0.09
Nodes (23): description, devDependencies, turbo@^2.4.4, typescript@^5.8.2, engines, node, typescript, name (+15 more)

### Community 35 - "live.md"
Cohesion: 0.08
Nodes (22): Cleanup, Exit, First-time setup, Handle `accept`, Handle `discard`, Handle fallback, Handle `manual_edit_apply`, Handle `prefetch` (+14 more)

### Community 36 - "document.md"
Cohesion: 0.15
Nodes (13): Component translation rules, Narrative mapping, Scan mode (approach C: auto-extract, then confirm descriptive language), Schema, Step 1: Find the design assets, Step 2: Auto-extract what can be auto-extracted, Step 2b: Stage the frontmatter, Step 3: Ask the user for qualitative language (+5 more)

### Community 37 - "handleManualEditActivity"
Cohesion: 0.19
Nodes (24): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+16 more)

### Community 38 - "RequireAnyPermission"
Cohesion: 0.26
Nodes (3): RequireAnyPermission(), ShortagesController, normalizeRequestedQty()

### Community 39 - "web/package.json"
Cohesion: 0.05
Nodes (45): dependencies, @capacitor/android@^8.6.0, @capacitor/app@^8.1.2, @capacitor/core@^8.6.0, jsqr@^1.4.0, qrcode@^1.5.4, react@^18.3.1, react-dom@^18.3.1 (+37 more)

### Community 40 - "with"
Cohesion: 0.09
Nodes (22): name, runs-on, steps, jobs, build-android-apk, name, on, push (+14 more)

### Community 41 - "onboard.md"
Cohesion: 0.09
Nodes (22): Assess Onboarding Needs, Context Over Ceremony, Contextual Help, Design Onboarding Experiences, Documentation & Help, Empty State Design, Feature Discovery & Adoption, Guided Tours & Walkthroughs (+14 more)

### Community 42 - "CurrentAuth"
Cohesion: 0.12
Nodes (3): AuthController, verifyPinHash(), AuthContext

### Community 43 - "ShortagesView"
Cohesion: 0.13
Nodes (23): ShortageComposerForm(), parseQtyInputForPayload(), QTY_PRESETS, SHORTAGE_CATEGORIES, ShortagesView(), adjustQty(), handleBulkAddCatalog(), handleDeleteCatalogItem() (+15 more)

### Community 44 - "impeccable/SKILL.md"
Cohesion: 0.07
Nodes (25): Craft floor, Refuse, Verify, Constraints, Failure modes, Flow, $impeccable hooks, Routing (+17 more)

### Community 45 - "The Toolkit"
Cohesion: 0.10
Nodes (20): Animate complex properties, Assess What "Extraordinary" Means Here, For data-heavy interfaces, For functional UI, For performance-critical UI, For visual/marketing surfaces, Implement with Discipline, Interact with the device (+12 more)

### Community 46 - "getClientIp"
Cohesion: 0.25
Nodes (3): getClientIp(), CurrentAuth, RbacController

### Community 47 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, incremental, module (+10 more)

### Community 48 - "database.service.ts"
Cohesion: 0.06
Nodes (11): deterministicUuidFromSeed(), signSessionToken(), verifySignedTokenFormat(), EffectiveScheduleEmployee, LEGACY_FAKE_EMPLOYEE_IDS, LEGACY_FAKE_USER_IDS, SCHEDULE_DDL_STATEMENTS, ScheduleSettings (+3 more)

### Community 49 - "createLiveBrowserSessionState"
Cohesion: 0.21
Nodes (15): createLiveBrowserSessionState(), clearHandled(), clearScrollY(), clearSession(), isHandled(), loadSession(), markHandled(), nextCheckpointRevision() (+7 more)

### Community 51 - "useWalkieTalkie.js"
Cohesion: 0.14
Nodes (21): deleteWalkieCall(), activeSupabaseAnonKey, activeSupabaseUrl, configureCloudRealtimeFromBootstrap(), ensureStoreSyncChannel(), flattenPresenceState(), getGlobalSupabaseClient(), joinGlobalWalkieRoom() (+13 more)

### Community 52 - "shared/package.json"
Cohesion: 0.13
Nodes (16): devDependencies, @types/node@^22.13.10, typescript@^5.8.2, exports, @types/node, typescript, main, module (+8 more)

### Community 53 - "onAnnotDown"
Cohesion: 0.20
Nodes (17): beginEditPin(), buildAnnotationsForCapture(), buildPinElement(), cancelEditingPin(), clampPlaceholderSize(), finalizeEditingPin(), initAnnotOverlay(), localCoords() (+9 more)

### Community 54 - "resolveLiveInjectionAnchor"
Cohesion: 0.18
Nodes (17): buildSvelteExpressionTextMap(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), cloneWithoutElements(), collectTextNodes(), collectVisibleTexts(), cssEscapeIdent(), elementMatchesOriginalMarkup() (+9 more)

### Community 55 - "animate.md"
Cohesion: 0.12
Nodes (14): Accessibility and control, Choose material by meaning, Find the job, Implement to the runtime, Set the motion thesis, Timing and easing, Verify, Visitor mode (+6 more)

### Community 56 - "Handle `generate`"
Cohesion: 0.12
Nodes (16): 1. Read the screenshot (if present), 2. Wrap the element, 3. Load the action's reference, 4. Plan three variants: identity first, then mode, then axes, 5. Apply the freeform prompt (if present), 6. Deliver variants, 7. Parameters (composition-sized, 0-4 per variant), 8. Signal done (+8 more)

### Community 57 - "createLiveBrowserDomHelpers"
Cohesion: 0.17
Nodes (10): createLiveBrowserDomHelpers(), cssId(), liveUiRoot(), makeFrozenAnchor(), own(), pickable(), rectIsUsableAnchor(), uiAppend() (+2 more)

### Community 58 - "tasks"
Cohesion: 0.12
Nodes (15): dependsOn, outputs, cache, dependsOn, persistent, globalEnv, $schema, tasks (+7 more)

### Community 59 - ".bulkCreateEmployees"
Cohesion: 0.23
Nodes (3): EmployeesController, inferDefaultRoleFromDepartment(), normalizeDigits()

### Community 60 - "React/React Native Component Scaffolding"
Cohesion: 0.13
Nodes (14): 1. Analyze Component Requirements, 2. Generate React Component, 3. Generate React Native Component, 4. Generate Component Tests, 5. Generate Styles, 6. Generate Storybook Stories, Context, Do not use this skill when (+6 more)

### Community 61 - "Generate Report"
Cohesion: 0.13
Nodes (14): 1. Accessibility (A11y), 2. Performance, 3. Theming, 4. Responsive Design, 5. Implementation Integrity (CRITICAL), Audit Health Score, Detailed Findings by Severity, Diagnostic Scan (+6 more)

### Community 62 - "New visual work"
Cohesion: 0.14
Nodes (14): 1. Decide what is already true, 2. Ask what will change the work, 3. Choose the right amount of invention, 4. Commit the world, 5. Record the decision, 6. Build with full commitment, 7. Inspect and finish, Both paths (+6 more)

### Community 63 - "optimize.md"
Cohesion: 0.14
Nodes (13): Animation Performance, Assess Performance Issues, Core Web Vitals Optimization, Cumulative Layout Shift (CLS < 0.1), Interaction to Next Paint (INP < 200ms), Largest Contentful Paint (LCP < 2.5s), Loading Performance, Network Optimization (+5 more)

### Community 66 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+3 more)

### Community 67 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+3 more)

### Community 68 - "critique.md"
Cohesion: 0.17
Nodes (11): Action Summary, Ask the User, Assessment A: Design Review, Assessment B: Detector + Browser Evidence, Assessment Orchestration, Deliver the Report, Hard Invariants, Persist the Snapshot (+3 more)

### Community 69 - "Simplify the Design"
Cohesion: 0.17
Nodes (11): Assess Current State, Code Simplification, Content Simplification, Document Removed Complexity, Information Architecture, Interaction Simplification, Layout Simplification, Plan Simplification (+3 more)

### Community 70 - "Hardening Dimensions"
Cohesion: 0.17
Nodes (11): Accessibility Resilience, Assess Hardening Needs, Edge Cases & Boundary Conditions, Error Handling, Hardening Dimensions, Input Validation & Sanitization, Internationalization (i18n), Performance Resilience (+3 more)

### Community 71 - "clarify.md"
Cohesion: 0.18
Nodes (10): Actions and navigation, Audit the language, Errors and permissions, Forms, Help and instructional text, Loading, empty, and success states, Rewrite by function, Set the message hierarchy (+2 more)

### Community 72 - "Nielsen's 10 Heuristics"
Cohesion: 0.18
Nodes (11): 10. Help and Documentation, 1. Visibility of System Status, 2. Match Between System and Real World, 3. User Control and Freedom, 4. Consistency and Standards, 5. Error Prevention, 6. Recognition Rather Than Recall, 7. Flexibility and Efficiency of Use (+3 more)

### Community 73 - "Generate Combined Critique Report"
Cohesion: 0.18
Nodes (11): Design Health Score, Design Specificity Verdict, Generate Combined Critique Report, Minor Observations, Overall Impression, Persona Red Flags, Priority Issues, Questions to Consider (+3 more)

### Community 74 - "polish.md"
Cohesion: 0.18
Nodes (10): 1. Establish the system, 2. Gather the evidence, 3. Triage, 4. Polish the whole path, 5. Verify and finish, Color, imagery, and icons, Content and code, Flow and hierarchy (+2 more)

### Community 75 - "quieter.md"
Cohesion: 0.18
Nodes (10): Assess Current State, Color Refinement, Composition Refinement, Motion Reduction, Plan Refinement, Refine the Design, Simplification, Verify Quality (+2 more)

### Community 76 - "api.e2e.test.mjs"
Cohesion: 0.09
Nodes (8): execSupabaseRpcSql(), getResolvedSupabaseConfig(), httpAgent, httpsAgent, postSupabaseJson(), require, ZAYED_SUPABASE_ANON_KEY, ZAYED_SUPABASE_URL

### Community 77 - "app.factory.ts"
Cohesion: 0.27
Nodes (7): CreateNestAppOptions, createZayedNestApp(), repoRoot, AppModule, bootstrap(), getExpressInstance(), serverlessHandler()

### Community 78 - "Init flow"
Cohesion: 0.20
Nodes (10): Completion gate, Init flow, Step 1: Load current state, Step 2: Explore the project, Step 3: Interview for product truth, Step 4: Write PRODUCT.md, Step 5: Record workflow defaults, Step 6: Wrap up or resume (+2 more)

### Community 79 - "document.md"
Cohesion: 0.18
Nodes (10): Pitfalls, Seed mode, Step 1: Route through new-work's workshop, Step 2: Write seed DESIGN.md, Step 3: Confirm, Style guidelines, The frontmatter: token schema, The markdown body: eight sections (canonical order) (+2 more)

### Community 80 - "colorize.md"
Cohesion: 0.25
Nodes (7): Apply at system scale, Audit before choosing, Choose a strategy, Contrast and perception, Live-mode signature params, Verify, Visitor mode

### Community 81 - "Common Cognitive Load Violations"
Cohesion: 0.22
Nodes (9): 1. The Wall of Options, 2. The Memory Bridge, 3. The Hidden Navigation, 4. The Jargon Barrier, 5. The Visual Noise Floor, 6. The Inconsistent Pattern, 7. The Multi-Task Demand, 8. The Context Switch (+1 more)

### Community 82 - "iOS platform"
Cohesion: 0.22
Nodes (9): Color & materials, Components & controls, iOS platform, Layout & structure, Motion, The iOS slop test, Touch targets, Typography (+1 more)

### Community 83 - "bolder.md"
Cohesion: 0.33
Nodes (5): Before you finish, Scope is sovereign, The amplification, The skeleton test, Why it reads flat

### Community 84 - "Shape"
Cohesion: 0.22
Nodes (8): Cadence, Confirm and stop, Phase 1: Discovery interview, Phase 2: Resolve the design direction, Phase 3: Write the brief, Round 1: purpose, people, and outcome, Round 2: material, behavior, and boundaries, Shape

### Community 85 - "vercel.json"
Cohesion: 0.22
Nodes (8): includeFiles, maxDuration, buildCommand, functions, api/index.js, headers, outputDirectory, rewrites

### Community 88 - "adapt.native.md"
Cohesion: 0.25
Nodes (7): Adaptation Strategies, Assess Adaptation Challenge, Implement & Verify, Orientation & foldables, Phone → Tablet (iPad / large screens), Platform → platform (iOS ↔ Android), Web → native (porting a website or web app)

### Community 89 - "Android platform"
Cohesion: 0.25
Nodes (8): Android platform, Color & theming, Components & motion, Layout & structure, The Android slop test, Touch targets, Typography, Verifying the build

### Community 90 - "Persona-Based Design Testing"
Cohesion: 0.25
Nodes (8): 1. Impatient Power User: "Alex", 2. Confused First-Timer: "Jordan", 3. Accessibility-Dependent User: "Sam", 4. Deliberate Stress Tester: "Riley", 5. Distracted Mobile User: "Casey", Persona-Based Design Testing, Project-Specific Personas, Selecting Personas

### Community 91 - "Extract Flow"
Cohesion: 0.25
Nodes (7): Extract Flow, Step 1: Discover the Design System, Step 2: Identify Patterns, Step 3: Plan Extraction, Step 4: Extract & Enrich, Step 5: Migrate, Step 6: Document

### Community 93 - "Generate Report"
Cohesion: 0.29
Nodes (7): Audit Health Score, Detailed Findings by Severity, Executive Summary, Generate Report, Patterns & Systemic Issues, Platform Conformance Verdict, Positive Findings

### Community 94 - "Cognitive Load Assessment"
Cohesion: 0.29
Nodes (7): Cognitive Load Assessment, Cognitive Load Checklist, Extraneous Load: Bad Design, Germane Load: Learning Effort, Intrinsic Load: The Task Itself, The Working Memory Rule, Three Types of Cognitive Load

### Community 95 - "Impeccable Asset Producer"
Cohesion: 0.29
Nodes (6): Core Rule, Decision Comps, Impeccable Asset Producer, Input Contract, Output Contract, The job

### Community 96 - "Impeccable Finish Reviewer"
Cohesion: 0.29
Nodes (6): Checks, in order, Disposition, Impeccable Finish Reviewer, Input Contract, Output Contract, Verdict Pass

### Community 97 - "Impeccable Manual Edit Applier"
Cohesion: 0.29
Nodes (6): Checks, Entry Atomicity, Impeccable Manual Edit Applier, Input Contract, Output Contract, Workflow

### Community 98 - "live-browser-ignores.js"
Cohesion: 0.52
Nodes (6): globToRegex(), matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates(), resolveDetectIgnores()

### Community 99 - "nest-cli.json"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 100 - "ZayedMart Design System — Tactile Retail Command"
Cohesion: 0.33
Nodes (5): Aesthetic Direction, Component Catalog (`apps/web/src/components/ui/`), Mobile Thumb-Zone Architecture, Tokens & Typography (`apps/web/src/index.css`), ZayedMart Design System — Tactile Retail Command

### Community 103 - "Visualize: Direction Comps & Asset Production"
Cohesion: 0.33
Nodes (5): After approval: the comp becomes a spec, Generate three compositional options, One approval point, Plates and provenance, Visualize: Direction Comps & Asset Production

### Community 106 - "interface"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 107 - "Impeccable Documenter"
Cohesion: 0.40
Nodes (4): Impeccable Documenter, Input Contract, Output Contract, Workflow

### Community 109 - "Heuristics Scoring Guide"
Cohesion: 0.50
Nodes (4): Heuristics Scoring Guide, Issue Severity (P0–P3), Reference Material, Score Summary

## Knowledge Gaps
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.jsx` to `api.js`, `web/package.json`, `apiRequest`, `ShortagesView`, `playSuccessChime`, `exportUtils.js`, `AttendanceView.jsx`, `useWalkieTalkie.js`, `AttendanceView`, `localDb.js`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Should `live-browser.js` be split into smaller, more focused modules?**
  _Cohesion score 0.02826310380267215 - nodes in this community are weakly interconnected._
- **Why does `apiRequest()` connect `apiRequest` to `App.jsx`, `api.js`, `ShortagesView`, `playSuccessChime`, `exportUtils.js`, `AttendanceView.jsx`, `useWalkieTalkie.js`, `AttendanceView`, `localDb.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Should `resumeSession` be split into smaller, more focused modules?**
  _Cohesion score 0.06265432098765432 - nodes in this community are weakly interconnected._
- **Why does `DatabaseService` connect `DatabaseService` to `.createMessage`, `RequireAnyPermission`, `AuthGuard`, `CurrentAuth`, `app.module.ts`, `getClientIp`, `app.factory.ts`, `database.service.ts`, `.respondToSwap`, `.quickScan`, `bootstrap.module.ts`, `RequirePermission`, `PermissionsGuard`, `.execute`, `AuthContext`, `.bulkCreateEmployees`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Should `useWalkieTalkie.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10976430976430976 - nodes in this community are weakly interconnected._
- **Should `setLiveState` be split into smaller, more focused modules?**
  _Cohesion score 0.10048076923076923 - nodes in this community are weakly interconnected._