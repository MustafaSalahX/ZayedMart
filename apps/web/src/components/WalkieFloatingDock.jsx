import React, { useRef } from 'react';

/**
 * كبسولة اللاسلكي التكتيكية العائمة + شريط نداء الشرطة الفوري (Police Radio Auto-Dispatch Capsule)
 * - تستقبل وتُسمع صوت أي زميل يفتح الخط أو يتحدث تلقائياً بدون الحاجة لفتح النافذة مسبقاً
 * - تعرض شريط نداء وارد فوري (عادي أو طوارئ 🚨) مع زر (اضغط مطولاً للرد الفوري)
 */
export default function WalkieFloatingDock({ walkie, hasBottomNav = true }) {
  const pointerIdRef = useRef(null);
  const replyPointerIdRef = useRef(null);

  const {
    canUseWalkie,
    currentChannelMeta,
    liveOn,
    connectingLive,
    toggleLivePower,
    receiveMode = 'all',
    emergencyMode = false,
    micMode,
    setMicMode,
    localSpeaking,
    setConsoleOpen,
    txElapsedSec,
    activeUnits,
    liveSpeakingUnits = [],
    incomingDispatchAlert,
    dismissDispatchAlert,
    activePlaybackCall,
    startTransmit,
    stopTransmit,
  } = walkie;

  if (!canUseWalkie) return null;

  const isReceiving = liveSpeakingUnits.length > 0 || Boolean(activePlaybackCall);
  const isEmergencyIncoming =
    Boolean(incomingDispatchAlert?.is_emergency) ||
    Boolean(activePlaybackCall?.is_emergency) ||
    liveSpeakingUnits.some((u) => u.is_emergency);

  const liveSpeakersLabel =
    activePlaybackCall?.sender_name ||
    liveSpeakingUnits.map((u) => u.display_name).filter(Boolean).join(' + ') ||
    incomingDispatchAlert?.sender_name ||
    '';

  function handleMicPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (liveOn && micMode !== 'muted') return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pointerIdRef.current = e.pointerId;
    } catch {
      // ignore
    }
    startTransmit();
  }

  function handleMicPointerUp(e) {
    if (pointerIdRef.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture?.(pointerIdRef.current);
    } catch {
      // ignore
    }
    pointerIdRef.current = null;
    stopTransmit();
  }

  function handleQuickMicClick(e) {
    e.stopPropagation();
    if (!liveOn) {
      setConsoleOpen(true);
      return;
    }
    if (micMode === 'muted') {
      setMicMode('vad');
    } else {
      setMicMode('muted');
    }
  }

  function handleBannerReplyDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      replyPointerIdRef.current = e.pointerId;
    } catch {
      // ignore
    }
    startTransmit({ asEmergency: isEmergencyIncoming });
  }

  function handleBannerReplyUp(e) {
    if (replyPointerIdRef.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture?.(replyPointerIdRef.current);
    } catch {
      // ignore
    }
    replyPointerIdRef.current = null;
    stopTransmit();
  }

  const showDispatchCard = Boolean((isReceiving || incomingDispatchAlert) && !localSpeaking);

  return (
    <div
      className={`fixed left-3 sm:left-6 z-40 flex flex-col items-start gap-2 transition-all duration-200 ${
        hasBottomNav ? 'bottom-21 md:bottom-6' : 'bottom-5'
      }`}
    >
      {/* Live Police Radio Incoming Dispatch Banner (Pops up automatically on call/session open!) */}
      {showDispatchCard && (
        <div
          className={`w-[300px] sm:w-[340px] rounded-2xl p-3 shadow-2xl border-2 backdrop-blur-md animate-pop text-white ${
            isEmergencyIncoming
              ? 'bg-[#3B0A0D]/95 border-[#FF453A] shadow-[0_10px_32px_rgba(255,69,58,0.55)]'
              : 'bg-[#062819]/95 border-[#00E676] shadow-[0_10px_28px_rgba(0,230,118,0.35)]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isEmergencyIncoming
                    ? 'bg-[#FF453A] text-white animate-pulse'
                    : 'bg-[#00E676] text-[#041E0F]'
                }`}
              >
                <span className="ms-icon filled text-lg">
                  {isEmergencyIncoming ? 'e911_emergency' : 'podcasts'}
                </span>
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black truncate">
                    {isEmergencyIncoming
                      ? `🚨 طوارئ: ${liveSpeakersLabel || 'نداء عاجل'}`
                      : `${liveSpeakersLabel || 'زميل'} على الخط الآن`}
                  </span>
                </div>
                <div className="text-[10px] font-bold text-white/80 truncate">
                  {incomingDispatchAlert?.kind === 'session_open' && !isReceiving
                    ? `فتح خط اللاسلكي (${incomingDispatchAlert.channel_label || currentChannelMeta.shortLabel})`
                    : isEmergencyIncoming
                    ? 'اختراق صوتي مباشر لكل القنوات — يُسمع تلقائياً'
                    : `يتحدث الآن على ${currentChannelMeta.shortLabel} — يُسمع تلقائياً`}
                </div>
              </div>
            </div>

            {incomingDispatchAlert && !isReceiving && (
              <button
                type="button"
                onClick={dismissDispatchAlert}
                aria-label="إغلاق التنبيه"
                className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 cursor-pointer shrink-0"
              >
                <span className="ms-icon text-sm">close</span>
              </button>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={handleBannerReplyDown}
              onPointerUp={handleBannerReplyUp}
              onPointerCancel={handleBannerReplyUp}
              className={`flex-1 min-h-[38px] px-3 py-1.5 rounded-xl font-black text-xs select-none touch-none flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-96 ${
                isEmergencyIncoming
                  ? 'bg-white text-[#B91C1C]'
                  : 'bg-[#00E676] text-[#041E0F]'
              }`}
            >
              <span className="ms-icon filled text-base">mic</span>
              <span>اضغط مطولاً للرد الفوري</span>
            </button>

            <button
              type="button"
              onClick={() => setConsoleOpen(true)}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/12 hover:bg-white/20 text-white text-xs font-extrabold flex items-center justify-center gap-1 cursor-pointer shrink-0"
            >
              <span className="ms-icon text-sm">open_in_full</span>
              <span>اللوحة</span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`rounded-full p-1.5 pl-2 pr-2 shadow-xl border flex items-center gap-2 backdrop-blur-md transition-colors duration-200 ${
          localSpeaking
            ? 'bg-[#2B0B0E]/95 border-[#FF453A] text-white shadow-[0_8px_28px_rgba(255,69,58,0.45)]'
            : isEmergencyIncoming && isReceiving
            ? 'bg-[#3B0A0D]/95 border-[#FF453A] text-white shadow-[0_8px_28px_rgba(255,69,58,0.48)]'
            : isReceiving
            ? 'bg-[#07291A]/95 border-[#00E676] text-white shadow-[0_8px_28px_rgba(0,230,118,0.38)]'
            : liveOn
            ? 'bg-[#091C14]/95 border-[#00E676]/75 text-[#E6EDF3] shadow-[0_8px_24px_rgba(0,230,118,0.2)]'
            : 'bg-[#0D1117]/95 border-[#2B3544] text-[#E6EDF3]'
        }`}
      >
        {/* Primary ON / OFF Live Channel Power Pill (>= 48px touch height) */}
        <button
          type="button"
          onClick={toggleLivePower}
          disabled={connectingLive}
          title={
            liveOn
              ? 'إيقاف مايك الخط الحي (يبقى الاستقبال التلقائي كالشرطة نشطاً)'
              : 'فتح جلسة تحدث حية وإشعار جميع المتصلين على القناة فوراً (ON)'
          }
          aria-label={liveOn ? 'إيقاف الخط الحي لللاسلكي' : 'تشغيل الخط الحي لللاسلكي'}
          className={`min-h-[48px] px-3.5 rounded-full select-none flex items-center justify-center gap-1.5 shrink-0 border-2 text-xs font-black transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] ${
            liveOn
              ? emergencyMode
                ? 'bg-[#FF453A] hover:bg-[#D93025] border-white/80 text-white'
                : 'bg-[#00E676] hover:bg-[#00C853] border-white/80 text-[#041E0F]'
              : 'bg-[#16202E] hover:bg-[#1E2C3F] border-[#00E676] text-[#00E676]'
          }`}
        >
          <span className="ms-icon filled text-lg">
            {connectingLive ? 'sync' : emergencyMode && liveOn ? 'e911_emergency' : 'power_settings_new'}
          </span>
          <span className="num-ltr tracking-wide">
            {connectingLive ? '...' : liveOn ? 'LIVE ON' : 'ON'}
          </span>
        </button>

        {/* Channel Status / Expand Full Radio Console Button (min-h 44px) */}
        <button
          type="button"
          onClick={() => setConsoleOpen(true)}
          aria-label="فتح شاشة جهاز اللاسلكي الكاملة"
          className="min-h-[44px] px-1.5 text-right flex flex-col justify-center min-w-0 max-w-[165px] sm:max-w-[225px] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] rounded-xl"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                localSpeaking
                  ? 'bg-[#FF453A] animate-ping'
                  : isReceiving
                  ? 'bg-[#00E676] animate-ping'
                  : liveOn || receiveMode === 'all'
                  ? 'bg-[#00E676]'
                  : 'bg-[#FBBF24]'
              }`}
            />
            <span className="text-xs font-black truncate text-white">
              {localSpeaking
                ? `تتحدث حياً (${txElapsedSec.toFixed(0)}ث)`
                : isReceiving && liveSpeakersLabel
                ? `${liveSpeakersLabel} يتحدث...`
                : liveOn
                ? `خط حي مفتوح • ${currentChannelMeta.shortLabel}`
                : `لاسلكي ${currentChannelMeta.shortLabel}`}
            </span>
          </div>
          <div className="text-[10px] font-bold text-[#94A3B8] truncate flex items-center gap-1">
            <span className="num-ltr text-[#00E676] font-extrabold">
              {currentChannelMeta.code}
            </span>
            <span>•</span>
            <span>
              {liveOn
                ? micMode === 'muted'
                  ? 'مايك مكتوم • استماع بالخلفية'
                  : activeUnits.length > 1
                  ? `${activeUnits.length} متصلون بالخلفية`
                  : 'متصل بالخلفية — تكلم فوراً'
                : receiveMode === 'all'
                ? 'استقبال الشرطة التلقائي نشط'
                : receiveMode === 'emergency_only'
                ? 'يستقبل الطوارئ تلقائياً 🚨'
                : 'اضغط ON لفتح الخط'}
            </span>
          </div>
        </button>

        {/* Live Mic / Instant Hold-to-Talk Control (48x48px) */}
        <button
          type="button"
          onContextMenu={(e) => e.preventDefault()}
          onClick={handleQuickMicClick}
          onPointerDown={handleMicPointerDown}
          onPointerUp={handleMicPointerUp}
          onPointerCancel={handleMicPointerUp}
          title={
            !liveOn
              ? 'اضغط مطولاً للتحدث الفوري أو انقر لفتح لوحة اللاسلكي'
              : micMode === 'muted'
              ? 'انقر لتفعيل التحدث التلقائي أو اضغط مطولاً للتحدث المؤقت'
              : 'المايك الحي مفعل — انقر لكتم المايك مع بقاء الاستماع بالخلفية'
          }
          aria-label="زر التحدث والمايكروفون"
          className={`w-12 h-12 rounded-full select-none touch-none flex items-center justify-center shrink-0 border transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] ${
            localSpeaking
              ? 'bg-[#FF3B30] border-white text-white'
              : !liveOn
              ? 'bg-white/8 hover:bg-white/15 border-[#00E676]/50 text-[#00E676]'
              : micMode === 'muted'
              ? 'bg-white/8 hover:bg-white/15 border-white/15 text-[#94A3B8]'
              : 'bg-[#00E676]/20 hover:bg-[#00E676]/30 border-[#00E676] text-[#00E676]'
          }`}
        >
          <span className="ms-icon filled text-xl">
            {localSpeaking
              ? 'mic'
              : !liveOn
              ? 'record_voice_over'
              : micMode === 'muted'
              ? 'mic_off'
              : 'mic'}
          </span>
        </button>
      </div>
    </div>
  );
}
