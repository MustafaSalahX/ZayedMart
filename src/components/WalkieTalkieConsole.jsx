import React, { useEffect, useRef } from 'react';
import { formatTimeArabic } from '../lib/exportUtils.js';

const ROLE_ARABIC_SHORT = {
  owner: 'الأدمن',
  manager: 'المدير',
  supervisor: 'المشرف',
  security: 'الأمن',
  cctv: 'مراقب الكاميرات',
  warehouse: 'المخزن',
  cashier: 'الكاشير',
  hall: 'الصالة',
  delivery: 'الدليفري',
};

const MIC_MODES = [
  {
    id: 'vad',
    label: 'تلقائي بالصوت',
    sub: 'تكلم مباشرةً في أي وقت',
    icon: 'record_voice_over',
  },
  {
    id: 'open',
    label: 'مفتوح دائماً',
    sub: 'بث صوتي مستمر للقناة',
    icon: 'mic',
  },
  {
    id: 'muted',
    label: 'كتم المايك',
    sub: 'استماع حي + ضغط للتحدث',
    icon: 'mic_off',
  },
];

export default function WalkieTalkieConsole({
  open,
  onClose,
  walkie,
  authUser,
  canManageRecords = false,
}) {
  const activePointerIdRef = useRef(null);

  const {
    peerId,
    allowedChannels,
    activeChannel,
    currentChannelMeta,
    selectChannel,
    liveOn,
    connectingLive,
    toggleLivePower,
    turnLiveOn,
    micMode,
    setMicMode,
    localSpeaking,
    pttOverride,
    txElapsedSec,
    liveLevels,
    activeUnits,
    liveSpeakingUnits = [],
    meshConnectedCount = 0,
    bgKeepAliveActive = false,
    wakeLockActive = false,
    micWarning = '',
    serverRouteMissing = false,
    recentCalls = [],
    activePlaybackCall,
    startTransmit,
    stopTransmit,
    cancelTransmit,
    sendAlertPing,
    replayCall,
    removeCall,
  } = walkie;

  const isReceiving = liveSpeakingUnits.length > 0 || Boolean(activePlaybackCall);

  // Desktop Spacebar Push-To-Talk override for CCTV & Supervisors
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;

    const handleKeyDown = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      startTransmit();
    };

    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      stopTransmit();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [open, startTransmit, stopTransmit]);

  if (!open) return null;

  function handleCenterButtonClick() {
    if (!liveOn) {
      turnLiveOn();
    }
  }

  function handlePttPointerDown(e) {
    if (!liveOn) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      activePointerIdRef.current = e.pointerId;
    } catch {
      // ignore
    }
    startTransmit();
  }

  function handlePttPointerUp(e) {
    if (activePointerIdRef.current === null && !pttOverride) return;
    e.preventDefault();
    if (activePointerIdRef.current !== null) {
      try {
        e.currentTarget.releasePointerCapture?.(activePointerIdRef.current);
      } catch {
        // ignore
      }
      activePointerIdRef.current = null;
    }
    stopTransmit();
  }

  const speakingNamesBanner = activePlaybackCall
    ? `${activePlaybackCall.sender_name}${
        ROLE_ARABIC_SHORT[activePlaybackCall.sender_role]
          ? ` (${ROLE_ARABIC_SHORT[activePlaybackCall.sender_role]})`
          : ''
      }`
    : liveSpeakingUnits
        .map((u) => {
          const r = ROLE_ARABIC_SHORT[u.role];
          return r ? `${u.display_name} (${r})` : u.display_name;
        })
        .join(' + ');

  const speakingPeerIds = new Set(liveSpeakingUnits.map((u) => u.peer_id));

  return (
    <div
      onClick={() => {
        if (!pttOverride) onClose?.();
      }}
      className="g-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="جهاز اللاسلكي الحي المباشر"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="g-dialog-sheet max-w-lg animate-pop space-y-4"
      >
        <div className="g-sheet-handle" />

        {/* Header Bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#0D1117] text-[#00E676] border border-[#232A35] flex items-center justify-center shrink-0 shadow-sm">
              <span className="ms-icon filled text-2xl">podcasts</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black m-0 truncate">
                لاسلكي زايد مارت الحي (Live Walkie-Talkie)
              </h2>
              <p className="text-xs text-[var(--g-muted)] m-0 truncate">
                خط صوتي حي متزامن لكل القناة + استمرار العمل في الخلفية
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (pttOverride) cancelTransmit();
              onClose?.();
            }}
            aria-label="إغلاق نافذة اللاسلكي"
            className="w-11 h-11 rounded-full bg-[var(--g-surface-variant)] hover:bg-[var(--g-border)] flex items-center justify-center transition-colors duration-200 cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--g-primary)]"
          >
            <span className="ms-icon">close</span>
          </button>
        </div>

        {/* Server Stale Route Notice (If an older server process was running) */}
        {serverRouteMissing && (
          <div className="p-3 rounded-2xl bg-[var(--g-amber-bg)] border border-[var(--g-amber)]/40 text-[var(--g-amber)] text-xs font-extrabold flex items-center gap-2">
            <span className="ms-icon filled text-lg shrink-0">warning</span>
            <span>
              تنبيه: الخادم المفتوح حالياً يعمل بنسخة قديمة قبل التحديث — أعد تشغيل الخادم (أو افتح ملف تشغيل زايد مارت) لتفعيل البث الحي الكامل.
            </span>
          </div>
        )}

        {/* Microphone Guidance Notice (e.g. non-HTTPS LAN or listen-only desktop) */}
        {micWarning && liveOn && (
          <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-[var(--g-text)] text-xs font-bold flex items-center gap-2">
            <span className="ms-icon text-lg text-[#00C853] shrink-0">info</span>
            <span>{micWarning}</span>
          </div>
        )}

        {/* MASTER LIVE CHANNEL POWER SWITCH (ON / OFF) */}
        <div
          className={`rounded-3xl p-4 border-2 flex flex-wrap items-center justify-between gap-3 transition-colors duration-200 ${
            liveOn
              ? 'bg-[#07291A] border-[#00E676] text-white shadow-[0_8px_24px_rgba(0,230,118,0.18)]'
              : 'bg-[#0D1117] border-[#262E3B] text-[#E6EDF3]'
          }`}
        >
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  liveOn ? 'bg-[#00E676] animate-pulse' : 'bg-[#64748B]'
                }`}
              />
              <span className="text-sm sm:text-base font-black">
                {liveOn
                  ? 'الخط الصوتي الحي مفتوح للقناة (LIVE ON)'
                  : 'الخط الصوتي الحي متوقف حالياً (OFF)'}
              </span>
            </div>
            <p className="text-[11px] text-[#B8C4D0] m-0 leading-relaxed">
              {liveOn
                ? 'أي زميل يتكلم يُسمع فوراً في نفس اللحظة، ويستمر اللاسلكي بالعمل حتى عند تصغير التطبيق أو قفل الشاشة.'
                : 'اضغط (تشغيل الخط الحي ON) لفتح الاتصال الصوتي الفوري مع كل المتصلين على القناة والعمل بالخلفية.'}
            </p>
            {liveOn && (
              <div className="flex items-center gap-2 flex-wrap pt-1 text-[10px] font-extrabold">
                <span className="px-2 py-0.5 rounded-full bg-[#00E676]/20 text-[#69F0AE] border border-[#00E676]/40 inline-flex items-center gap-1">
                  <span className="ms-icon text-xs">screen_lock_portrait</span>
                  <span>
                    {bgKeepAliveActive || wakeLockActive
                      ? 'نشط في الخلفية وشاشة القفل'
                      : 'متصل بالاستماع الحي'}
                  </span>
                </span>
                {meshConnectedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-white border border-white/15 inline-flex items-center gap-1 num-ltr">
                    <span className="ms-icon text-xs text-[#00E676]">hub</span>
                    <span>P2P Direct: {meshConnectedCount}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleLivePower}
            disabled={connectingLive}
            className={`min-h-[50px] px-5 py-2.5 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 shrink-0 transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${
              liveOn
                ? 'bg-[#FF3B30] hover:bg-[#D93025] text-white shadow-md'
                : 'bg-[#00E676] hover:bg-[#00C853] text-[#041E0F] shadow-[0_6px_20px_rgba(0,230,118,0.35)]'
            }`}
          >
            <span className="ms-icon filled text-xl">power_settings_new</span>
            <span>
              {connectingLive
                ? 'جاري فتح الخط...'
                : liveOn
                ? 'إيقاف الخط (OFF)'
                : 'تشغيل الخط الحي (ON)'}
            </span>
          </button>
        </div>

        {/* Tactical OLED Digital Frequency & Simultaneous Speakers Display */}
        <div className="rounded-3xl bg-[#0D1117] text-[#E6EDF3] border border-[#262E3B] p-4 space-y-3 shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  style={{ color: currentChannelMeta.accent }}
                  className="num-ltr text-xs font-black tracking-wider px-2 py-0.5 rounded-md bg-white/8 border border-white/10"
                >
                  {currentChannelMeta.code} • {currentChannelMeta.freq}
                </span>
              </div>
              <div className="text-base sm:text-lg font-black text-white flex items-center gap-1.5">
                <span
                  style={{ color: currentChannelMeta.accent }}
                  className="ms-icon filled text-xl"
                >
                  {currentChannelMeta.icon}
                </span>
                <span className="truncate">{currentChannelMeta.label}</span>
              </div>
              <p className="text-[11px] text-[#9BA5B4] m-0 leading-snug">
                {currentChannelMeta.description}
              </p>
            </div>

            {/* Live TX / RX LED Indicator */}
            <div className="shrink-0">
              {localSpeaking ? (
                <div className="px-3 py-1.5 rounded-full bg-[#FF3B30]/20 border border-[#FF3B30] text-[#FF6961] text-xs font-black flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30] animate-ping" />
                  <span className="num-ltr">LIVE {txElapsedSec.toFixed(1)}s</span>
                </div>
              ) : isReceiving && liveOn ? (
                <div className="px-3 py-1.5 rounded-full bg-[#00E676]/20 border border-[#00E676] text-[#00E676] text-xs font-black flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#00E676] animate-pulse" />
                  <span>بث حي وارد ({liveSpeakingUnits.length || 1})</span>
                </div>
              ) : liveOn ? (
                <div className="px-3 py-1.5 rounded-full bg-[#00E676]/15 border border-[#00E676]/50 text-[#00E676] text-xs font-extrabold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#00E676]" />
                  <span>خط مفتوح</span>
                </div>
              ) : (
                <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[#94A3B8] text-xs font-bold">
                  في وضع الاستعداد
                </div>
              )}
            </div>
          </div>

          {/* Simultaneous Live Speaker Banner + 12-Bar GPU Audio Visualizer */}
          <div className="rounded-2xl bg-[#161B22] border border-[#262E3B] px-3.5 py-2.5 flex items-center justify-between gap-3 h-14">
            <div className="min-w-0 flex-1">
              {localSpeaking && speakingNamesBanner ? (
                <div className="text-xs sm:text-sm font-extrabold text-[#FBBF24] truncate flex items-center gap-1.5">
                  <span className="ms-icon filled text-base">graphic_eq</span>
                  <span>أنت + {speakingNamesBanner} تتحدثون معاً حياً...</span>
                </div>
              ) : localSpeaking ? (
                <div className="text-xs sm:text-sm font-extrabold text-[#FF6961] truncate flex items-center gap-1.5">
                  <span className="ms-icon filled text-base">mic</span>
                  <span>صوتك يُبث حياً الآن لكل القناة...</span>
                </div>
              ) : speakingNamesBanner && liveOn ? (
                <div className="text-xs sm:text-sm font-extrabold text-[#00E676] truncate flex items-center gap-1.5">
                  <span className="ms-icon filled text-base">graphic_eq</span>
                  <span>{speakingNamesBanner} يتحدث الآن حياً...</span>
                </div>
              ) : liveOn ? (
                <div className="text-xs font-bold text-[#A7F3D0] truncate flex items-center gap-1.5">
                  <span className="ms-icon text-base text-[#00E676]">sensors</span>
                  <span>
                    {micMode === 'muted'
                      ? 'تستمع للقناة حياً — اضغط الزر للتحدث'
                      : 'الخط صافي ومفتوح — تكلم مباشرةً بدون لمس أي زر'}
                  </span>
                </div>
              ) : (
                <div className="text-xs font-bold text-[#8B949E] truncate flex items-center gap-1.5">
                  <span className="ms-icon text-base text-[#64748B]">power_settings_new</span>
                  <span>اضغط تشغيل الخط الحي (ON) لبدء المحادثة المباشرة</span>
                </div>
              )}
            </div>

            {/* 12 GPU-Transformed Visualizer Bars (Zero Layout Shift) */}
            <div
              aria-hidden="true"
              className="flex items-center gap-1 h-8 shrink-0 px-1"
            >
              {liveLevels.map((lvl, idx) => (
                <span
                  key={idx}
                  style={{
                    transform: `scaleY(${Math.max(0.14, Math.min(1, lvl))})`,
                    backgroundColor: localSpeaking
                      ? '#FF453A'
                      : isReceiving && liveOn
                      ? '#00E676'
                      : liveOn
                      ? '#10B981'
                      : '#334155',
                  }}
                  className="w-1.5 h-7 rounded-full origin-center transition-transform duration-75 will-change-transform"
                />
              ))}
            </div>
          </div>

          {/* Connected Units Strip */}
          <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[#8B949E] font-bold shrink-0">المتصلون على القناة:</span>
              {activeUnits.length === 0 ? (
                <span className="text-[#94A3B8] font-bold">
                  {liveOn ? 'أنت متصل على الخط الحي' : 'لا يوجد متصلون حالياً'}
                </span>
              ) : (
                activeUnits.slice(0, 6).map((u) => {
                  const uKey = u.peer_id || u.user_id;
                  const isMe = u.peer_id ? u.peer_id === peerId : u.user_id === authUser?.id;
                  const isUnitTalking =
                    (isMe && localSpeaking) ||
                    u.status === 'talking' ||
                    speakingPeerIds.has(uKey);
                  return (
                    <span
                      key={uKey}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-extrabold border ${
                        isUnitTalking
                          ? 'bg-[#FF3B30]/20 border-[#FF3B30] text-[#FF8A80]'
                          : 'bg-white/6 border-white/10 text-[#E2E8F0]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isUnitTalking ? 'bg-[#FF3B30] animate-ping' : 'bg-[#00E676]'
                        }`}
                      />
                      <span className="truncate max-w-[105px]">
                        {isMe ? 'أنت' : u.display_name}
                      </span>
                    </span>
                  );
                })
              )}
              {activeUnits.length > 6 && (
                <span className="num-ltr text-[#94A3B8] font-extrabold">
                  +{activeUnits.length - 6}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Channel Switcher (For Multi-Channel Roles) OR Dedicated Security Lock Badge */}
        {allowedChannels.length > 1 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {allowedChannels.map((ch) => {
              const selected = ch.id === activeChannel;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => selectChannel(ch.id)}
                  className={`min-h-[46px] px-3 py-2 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--g-primary)] ${
                    selected
                      ? 'bg-[#0D1117] text-white border-[#00E676] shadow-xs'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)] hover:border-[var(--g-primary)]'
                  }`}
                >
                  <span
                    style={{ color: selected ? ch.accent : undefined }}
                    className={`ms-icon text-base ${selected ? 'filled' : ''}`}
                  >
                    {ch.icon}
                  </span>
                  <span className="truncate">{ch.shortLabel}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3.5 py-2.5 rounded-2xl bg-[var(--g-green-bg)] border border-[var(--g-green-border)]/40 text-[var(--g-green)] text-xs font-extrabold flex items-center justify-center gap-2">
            <span className="ms-icon filled text-base">verified_user</span>
            <span>جهازك مضبوط تلقائياً على تردد قناة الأمن والبوابة (CH-01)</span>
          </div>
        )}

        {/* 3-Way Live Microphone Mode Selector + Tactile Hardware Deck */}
        <div className="g-card p-4 sm:p-5 bg-[var(--g-surface-variant)]/55 space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-extrabold text-[var(--g-muted)] px-1 flex items-center justify-between">
              <span>وضع المايكروفون أثناء فتح الخط الحي:</span>
              <span className="text-[11px] font-bold text-[var(--g-primary)]">
                {micMode === 'vad'
                  ? 'حساسية صوتية ذكية (بدون ضوضاء)'
                  : micMode === 'open'
                  ? 'مايك مفتوح ١٠٠٪'
                  : 'استماع بالخلفية فقط'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MIC_MODES.map((m) => {
                const active = micMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMicMode(m.id)}
                    className={`min-h-[54px] px-2 py-2 rounded-2xl border text-center flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--g-primary)] ${
                      active
                        ? m.id === 'muted'
                          ? 'bg-[#1E293B] text-white border-[#64748B]'
                          : 'bg-[#0D1117] text-[#00E676] border-[#00E676]'
                        : 'bg-[var(--g-surface)] text-[var(--g-text)] border-[var(--g-border)] hover:border-[var(--g-primary)]'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-xs font-black">
                      <span className={`ms-icon text-base ${active ? 'filled' : ''}`}>
                        {m.icon}
                      </span>
                      <span>{m.label}</span>
                    </div>
                    <span className="text-[10px] opacity-80 font-bold hidden sm:inline">
                      {m.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Central Tactile Live Indicator / Instant PTT Override Circle */}
          <div className="flex flex-col items-center justify-center gap-3 pt-1">
            <div className="relative flex items-center justify-center">
              {localSpeaking && (
                <>
                  <span className="absolute inset-0 rounded-full bg-[#FF3B30]/35 walkie-pulse-ring pointer-events-none" />
                  <span
                    style={{ animationDelay: '0.45s' }}
                    className="absolute inset-0 rounded-full bg-[#FF3B30]/25 walkie-pulse-ring pointer-events-none"
                  />
                </>
              )}

              <button
                type="button"
                onContextMenu={(e) => e.preventDefault()}
                onClick={handleCenterButtonClick}
                onPointerDown={handlePttPointerDown}
                onPointerUp={handlePttPointerUp}
                onPointerCancel={handlePttPointerUp}
                aria-label={
                  !liveOn
                    ? 'اضغط لتشغيل الخط الحي للقناة'
                    : 'اضغط مطولاً للتحدث الفوري المباشر'
                }
                className={`relative z-10 w-38 h-38 sm:w-42 sm:h-42 rounded-full select-none touch-none flex flex-col items-center justify-center gap-1.5 border-4 transition-all duration-150 cursor-pointer shadow-lg focus-visible:outline-4 focus-visible:outline-[var(--g-primary)] ${
                  !liveOn
                    ? 'bg-[#0D1117] hover:bg-[#16202E] border-[#00E676] text-[#00E676]'
                    : localSpeaking
                    ? 'bg-[#D93025] border-[#FF8A80] text-white scale-96 shadow-[0_0_32px_rgba(217,48,37,0.55)]'
                    : micMode === 'muted'
                    ? 'bg-[#1E293B] hover:bg-[#273549] border-[#94A3B8] text-white'
                    : 'bg-[#07291A] hover:bg-[#0A3823] border-[#00E676] text-white shadow-[0_0_24px_rgba(0,230,118,0.25)]'
                }`}
              >
                <span className="ms-icon filled text-5xl">
                  {!liveOn
                    ? 'power_settings_new'
                    : localSpeaking
                    ? 'mic'
                    : micMode === 'muted'
                    ? 'touch_app'
                    : 'graphic_eq'}
                </span>
                <span className="text-sm font-black tracking-tight text-center px-2">
                  {!liveOn
                    ? 'اضغط لفتح الخط ON'
                    : localSpeaking
                    ? 'صوتك مباشر الآن'
                    : micMode === 'muted'
                    ? 'اضغط مطولاً للتحدث'
                    : 'الخط مفتوح • تكلم فوراً'}
                </span>
                <span className="text-[11px] font-bold opacity-85 num-ltr">
                  {!liveOn
                    ? 'OPEN LIVE CHANNEL'
                    : localSpeaking
                    ? `ON AIR • ${txElapsedSec.toFixed(1)}s`
                    : micMode === 'muted'
                    ? 'HOLD TO TALK'
                    : 'LIVE AUTO-TALK'}
                </span>
              </button>
            </div>

            {/* Urgent Pager Alert Button */}
            <div className="flex items-center justify-center w-full max-w-xs">
              <button
                type="button"
                onClick={sendAlertPing}
                className="w-full min-h-[48px] px-4 py-2 rounded-2xl bg-[var(--g-red-bg)] text-[var(--g-red)] border border-[var(--g-red-border)]/40 hover:border-[var(--g-red)] text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--g-red)]"
              >
                <span className="ms-icon filled text-base">notifications_active</span>
                <span>إرسال جرس انتباه عاجل لكل القناة</span>
              </button>
            </div>

            <p className="text-[11px] text-[var(--g-muted)] text-center m-0">
              عند تفعيل <strong className="text-[var(--g-text)]">LIVE ON</strong> يمكنك إغلاق هذه النافذة أو قفل شاشة الموبايل وسيبقى الخط الصوتي الحي متصلاً بالخلفية
            </p>
          </div>
        </div>

        {/* Recent Alerts & Recorded Clips Log */}
        {recentCalls.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs sm:text-sm font-extrabold m-0 flex items-center gap-1.5">
                <span className="ms-icon text-base text-[var(--g-primary)]">history</span>
                <span>آخر التنبيهات والنداءات المسجلة ({recentCalls.length})</span>
              </h3>
            </div>

            <div className="space-y-2 max-h-44 overflow-y-auto pr-0.5">
              {recentCalls.map((call) => {
                const isPlayingThis = activePlaybackCall?.id === call.id;
                const isMine = call.sender_id === authUser?.id;
                const roleText = ROLE_ARABIC_SHORT[call.sender_role] || call.sender_role;

                return (
                  <div
                    key={call.id}
                    className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2.5 transition-colors duration-150 ${
                      isPlayingThis
                        ? 'bg-[var(--g-green-bg)] border-[var(--g-green-border)]'
                        : call.is_emergency
                        ? 'bg-[var(--g-red-bg)]/60 border-[var(--g-red-border)]/40'
                        : 'bg-[var(--g-surface-variant)] border-[var(--g-border)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => replayCall(call)}
                        aria-label={`إعادة تشغيل نداء ${call.sender_name}`}
                        className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--g-primary)] ${
                          isPlayingThis
                            ? 'bg-[#137333] text-white'
                            : call.kind === 'ping'
                            ? 'bg-[var(--g-red)] text-white'
                            : 'bg-[var(--g-primary)] text-white'
                        }`}
                      >
                        <span className="ms-icon filled text-xl">
                          {isPlayingThis
                            ? 'graphic_eq'
                            : call.kind === 'ping'
                            ? 'notifications_active'
                            : 'play_arrow'}
                        </span>
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-[var(--g-text)] truncate">
                            {call.sender_name}
                          </span>
                          {roleText && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-surface)] text-[var(--g-muted)] font-extrabold">
                              {roleText}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--g-muted)] font-bold flex items-center gap-2 mt-0.5">
                          <span>
                            {call.kind === 'ping'
                              ? 'جرس انتباه عاجل'
                              : `نداء مسجل (${Number(call.duration_sec || 1).toFixed(1)} ث)`}
                          </span>
                          <span>•</span>
                          <span className="num-ltr">{formatTimeArabic(call.timestamp)}</span>
                        </div>
                      </div>
                    </div>

                    {(isMine || canManageRecords) && (
                      <button
                        type="button"
                        onClick={() => removeCall(call.id)}
                        aria-label="حذف النداء"
                        className="w-11 h-11 rounded-full hover:bg-[var(--g-red-bg)] text-[var(--g-muted)] hover:text-[var(--g-red)] flex items-center justify-center shrink-0 transition-colors duration-150 cursor-pointer"
                      >
                        <span className="ms-icon text-lg">delete</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
