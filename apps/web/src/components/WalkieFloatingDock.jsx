import React, { useRef } from 'react';

/**
 * كبسولة اللاسلكي العائمة للخط الحي (Floating Live Intercom Capsule)
 * - ضغطة واحدة على زر ON تفتح الخط الحي لكل القناة وتبقي الصوت يعمل في الخلفية وقفل الشاشة.
 * - تعرض المتحدثين المتزامنين لحظياً وتتيح كتم/فتح المايك أو الضغط للتحدث الفوري.
 */
export default function WalkieFloatingDock({ walkie, hasBottomNav = true }) {
  const pointerIdRef = useRef(null);

  const {
    canUseWalkie,
    currentChannelMeta,
    liveOn,
    connectingLive,
    toggleLivePower,
    micMode,
    setMicMode,
    localSpeaking,
    setConsoleOpen,
    txElapsedSec,
    activeUnits,
    liveSpeakingUnits = [],
    activePlaybackCall,
    startTransmit,
    stopTransmit,
  } = walkie;

  if (!canUseWalkie) return null;

  const isReceiving = liveSpeakingUnits.length > 0 || Boolean(activePlaybackCall);
  const liveSpeakersLabel =
    activePlaybackCall?.sender_name ||
    liveSpeakingUnits.map((u) => u.display_name).filter(Boolean).join(' + ');

  function handleMicPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (micMode !== 'muted') return;
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
    if (micMode === 'muted') {
      setMicMode('vad');
    } else {
      setMicMode('muted');
    }
  }

  return (
    <div
      className={`fixed left-3 sm:left-6 z-40 transition-all duration-200 ${
        hasBottomNav ? 'bottom-21 md:bottom-6' : 'bottom-5'
      }`}
    >
      <div
        className={`rounded-full p-1.5 pl-2 pr-2 shadow-xl border flex items-center gap-2 backdrop-blur-md transition-colors duration-200 ${
          localSpeaking
            ? 'bg-[#2B0B0E]/95 border-[#FF453A] text-white shadow-[0_8px_28px_rgba(255,69,58,0.45)]'
            : isReceiving && liveOn
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
              ? 'إيقاف الخط الحي لللاسلكي (OFF)'
              : 'فتح الخط الحي المباشر لكل القناة والعمل بالخلفية (ON)'
          }
          aria-label={liveOn ? 'إيقاف الخط الحي لللاسلكي' : 'تشغيل الخط الحي لللاسلكي'}
          className={`min-h-[48px] px-3.5 rounded-full select-none flex items-center justify-center gap-1.5 shrink-0 border-2 text-xs font-black transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] ${
            liveOn
              ? 'bg-[#00E676] hover:bg-[#00C853] border-white/80 text-[#041E0F]'
              : 'bg-[#16202E] hover:bg-[#1E2C3F] border-[#00E676] text-[#00E676]'
          }`}
        >
          <span className="ms-icon filled text-lg">
            {connectingLive ? 'sync' : 'power_settings_new'}
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
          className="min-h-[44px] px-1.5 text-right flex flex-col justify-center min-w-0 max-w-[160px] sm:max-w-[215px] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] rounded-xl"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                localSpeaking
                  ? 'bg-[#FF453A] animate-ping'
                  : isReceiving && liveOn
                  ? 'bg-[#00E676] animate-ping'
                  : liveOn
                  ? 'bg-[#00E676]'
                  : 'bg-[#64748B]'
              }`}
            />
            <span className="text-xs font-black truncate text-white">
              {!liveOn
                ? `لاسلكي ${currentChannelMeta.shortLabel}`
                : localSpeaking
                ? `تتحدث حياً (${txElapsedSec.toFixed(0)}ث)`
                : liveSpeakersLabel
                ? `${liveSpeakersLabel} يتحدث...`
                : `خط حي مفتوح • ${currentChannelMeta.shortLabel}`}
            </span>
          </div>
          <div className="text-[10px] font-bold text-[#94A3B8] truncate flex items-center gap-1">
            <span className="num-ltr text-[#00E676] font-extrabold">
              {currentChannelMeta.code}
            </span>
            <span>•</span>
            <span>
              {!liveOn
                ? 'اضغط ON لفتح الخط الحي'
                : micMode === 'muted'
                ? 'مايك مكتوم • استماع بالخلفية'
                : activeUnits.length > 1
                ? `${activeUnits.length} على الخط بالخلفية`
                : 'متصل بالخلفية — تكلم فوراً'}
            </span>
          </div>
        </button>

        {/* Live Mic Control (48x48px) — Shown when LIVE ON */}
        {liveOn ? (
          <button
            type="button"
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleQuickMicClick}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerUp}
            title={
              micMode === 'muted'
                ? 'انقر لتفعيل التحدث التلقائي أو اضغط مطولاً للتحدث المؤقت'
                : 'المايك الحي مفعل — انقر لكتم المايك مع بقاء الاستماع بالخلفية'
            }
            aria-label={micMode === 'muted' ? 'تفعيل مايك اللاسلكي' : 'كتم مايك اللاسلكي'}
            className={`w-12 h-12 rounded-full select-none touch-none flex items-center justify-center shrink-0 border transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676] ${
              localSpeaking
                ? 'bg-[#FF3B30] border-white text-white'
                : micMode === 'muted'
                ? 'bg-white/8 hover:bg-white/15 border-white/15 text-[#94A3B8]'
                : 'bg-[#00E676]/20 hover:bg-[#00E676]/30 border-[#00E676] text-[#00E676]'
            }`}
          >
            <span className="ms-icon filled text-xl">
              {micMode === 'muted' && !localSpeaking ? 'mic_off' : 'mic'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConsoleOpen(true)}
            title="فتح لوحة اللاسلكي الكاملة"
            aria-label="فتح لوحة اللاسلكي الكاملة"
            className="w-11 h-11 rounded-full bg-white/6 hover:bg-white/14 text-[#CBD5E1] flex items-center justify-center shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00E676]"
          >
            <span className="ms-icon text-xl">tune</span>
          </button>
        )}
      </div>
    </div>
  );
}
