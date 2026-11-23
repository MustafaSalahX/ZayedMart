import React, { useRef, useState } from 'react';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import { Icon } from './ui/index.js';

/**
 * Floating Walkie-Talkie Radio Capsule + Top Emergency Dispatch Banner.
 * - Theme-adaptive horizontal capsule pill when idle on mobile
 * - Tagged `.g-floating-chrome` so it automatically hides behind open sheets/modals
 */
export default function WalkieFloatingDock({
  walkie,
  hasBottomNav = true,
  compactOnDesktop = false,
}) {
  const arch = useThemeArchitecture();
  const pointerIdRef = useRef(null);
  const replyPointerIdRef = useRef(null);
  const didHoldTransmitRef = useRef(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

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
    activeUnits = [],
    liveSpeakingUnits = [],
    incomingDispatchAlert,
    dismissDispatchAlert,
    activePlaybackCall,
    startTransmit,
    stopTransmit,
  } = walkie || {};

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
    didHoldTransmitRef.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pointerIdRef.current = e.pointerId;
    } catch {
      // ignore
    }
    startTransmit?.();
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
    stopTransmit?.();
  }

  function handleQuickMicClick(e) {
    e.stopPropagation();
    if (didHoldTransmitRef.current) {
      didHoldTransmitRef.current = false;
      return;
    }
    if (!liveOn) {
      setConsoleOpen?.(true);
      return;
    }
    if (micMode === 'muted') {
      setMicMode?.('vad');
    } else {
      setMicMode?.('muted');
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
    startTransmit?.({ asEmergency: isEmergencyIncoming });
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
    stopTransmit?.();
  }

  const showDispatchCard = Boolean((isReceiving || incomingDispatchAlert) && !localSpeaking);
  const isRadioActive = Boolean(
    liveOn || localSpeaking || isReceiving || mobileExpanded
  );

  const isMinimal = arch?.id === 'minimal';
  const isGlass = arch?.id === 'liquid-glass';
  const idlePillSurfaceCls = isMinimal
    ? 'bg-surface border border-line text-ink shadow-xs hover:border-line-strong'
    : isGlass
    ? 'g-glass-capsule text-ink'
    : 'bg-surface-elevated border border-line text-ink shadow-[var(--g-shadow-elevated)] hover:border-line-strong';

  const channelShort =
    incomingDispatchAlert?.channel_label || currentChannelMeta?.shortLabel || 'الطوارئ';

  return (
    <>
      {/* 1. Top-Anchored Incoming Dispatch Banner */}
      {showDispatchCard && (
        <div
          className={`fixed top-[calc(var(--topbar-h)+0.5rem)] inset-x-3 sm:inset-x-auto sm:end-6 sm:w-[340px] z-[45] rounded-2xl p-3.5 shadow-xl border backdrop-blur-md animate-pop text-[var(--g-radio-text)] ${
            isEmergencyIncoming
              ? 'bg-[var(--g-radio-emergency-bg)] border-[var(--g-radio-emergency-bright)]'
              : 'bg-[var(--g-radio-bg)] border-[var(--g-radio-signal-bright)]'
          }`}
          role="region"
          aria-label="نداء وارد"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon
                name={isEmergencyIncoming ? 'e911_emergency' : 'podcasts'}
                size={18}
                filled
                className={
                  isEmergencyIncoming
                    ? 'text-[var(--g-radio-emergency-bright)] animate-pulse'
                    : 'text-[var(--g-radio-signal-bright)]'
                }
              />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold truncate">
                  {isEmergencyIncoming
                    ? `طوارئ · ${liveSpeakersLabel || 'نداء'}`
                    : liveSpeakersLabel || 'نداء وارد'}
                </div>
                <div className="text-[11px] font-medium text-[var(--g-radio-muted)] truncate">
                  {incomingDispatchAlert?.kind === 'session_open' && !isReceiving
                    ? `${channelShort} · متصل`
                    : `${channelShort} · مباشر`}
                </div>
              </div>
            </div>

            {incomingDispatchAlert && !isReceiving && (
              <button
                type="button"
                onClick={dismissDispatchAlert}
                aria-label="إغلاق"
                className="w-11 h-11 rounded-full bg-[var(--g-radio-surface)] border border-[var(--g-radio-border)] flex items-center justify-center text-[var(--g-radio-text)] cursor-pointer shrink-0"
              >
                <Icon name="close" size={16} />
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
              className={`flex-1 min-h-[44px] px-3 py-1.5 rounded-xl font-bold text-xs select-none touch-none flex items-center justify-center gap-1.5 cursor-pointer active:scale-96 ${
                isEmergencyIncoming
                  ? 'bg-[var(--g-radio-emergency)] text-[var(--g-radio-text)]'
                  : 'bg-[var(--g-radio-signal-bright)] text-[var(--g-radio-on-signal)]'
              }`}
            >
              <Icon name="mic" size={16} filled />
              <span>رد فوري</span>
            </button>

            <button
              type="button"
              onClick={() => setConsoleOpen?.(true)}
              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-[var(--g-radio-surface)] border border-[var(--g-radio-border)] text-[var(--g-radio-text)] text-xs font-semibold cursor-pointer shrink-0"
            >
              اللوحة
            </button>
          </div>
        </div>
      )}

      {/* 2. Bottom-Left Floating Radio Control */}
      <div
        className={`fixed g-floating-chrome left-3 sm:left-6 z-40 flex flex-col items-start gap-2 ${
          hasBottomNav
            ? 'bottom-[calc(var(--bottom-nav-h)+0.75rem)] md:bottom-6'
            : 'bottom-[calc(1.25rem+var(--safe-bottom))] md:bottom-6'
        }`}
      >
        {/* Idle Compact Theme-Adaptive Radio Pill */}
        {!isRadioActive && (
          <button
            type="button"
            onClick={() => setConsoleOpen?.(true)}
            aria-label={`اللاسلكي (${currentChannelMeta?.shortLabel || 'CH-01'})`}
            className={`${
              compactOnDesktop ? 'inline-flex' : 'inline-flex md:hidden'
            } h-11 px-3 rounded-full items-center gap-2 cursor-pointer active:scale-95 transition-[transform,border-color,background-color] duration-150 ${idlePillSurfaceCls}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                receiveMode === 'all' ? 'bg-success-solid' : 'bg-warning-solid'
              }`}
              aria-hidden="true"
            />
            <Icon name="podcasts" size={17} />
            <span className="num-ltr text-xs font-semibold leading-none">
              {currentChannelMeta?.code || 'CH-01'}
            </span>
          </button>
        )}

        {/* Full Radio Capsule */}
        <div
          className={`${
            isRadioActive ? 'flex' : compactOnDesktop ? 'hidden' : 'hidden md:flex'
          } rounded-full p-1.5 px-2 shadow-xl border items-center gap-2 backdrop-blur-md transition-colors duration-200 ${
            localSpeaking
              ? 'bg-[var(--g-radio-emergency-bg)] border-[var(--g-radio-emergency-bright)] text-[var(--g-radio-text)]'
              : isEmergencyIncoming && isReceiving
              ? 'bg-[var(--g-radio-emergency-bg)] border-[var(--g-radio-emergency-bright)] text-[var(--g-radio-text)]'
              : isReceiving
              ? 'bg-[var(--g-radio-bg)] border-[var(--g-radio-signal-bright)] text-[var(--g-radio-text)]'
              : liveOn
              ? 'bg-[var(--g-radio-bg)] border-[var(--g-radio-signal-border)] text-[var(--g-radio-text)]'
              : 'bg-[var(--g-radio-bg)] border-[var(--g-radio-border)] text-[var(--g-radio-text)]'
          }`}
        >
          {/* Primary ON / OFF Button */}
          <button
            type="button"
            onClick={toggleLivePower}
            disabled={connectingLive}
            aria-label={liveOn ? 'إيقاف اللاسلكي' : 'تشغيل اللاسلكي'}
            className={`min-h-[48px] px-3.5 rounded-full select-none flex items-center justify-center gap-1.5 shrink-0 border-2 text-xs font-bold transition-[background-color,border-color,color,opacity] duration-150 cursor-pointer ${
              liveOn
                ? emergencyMode
                  ? 'bg-[var(--g-radio-emergency)] border-[var(--g-radio-text)] text-[var(--g-radio-text)]'
                  : 'bg-[var(--g-radio-signal-bright)] border-[var(--g-radio-on-signal)] text-[var(--g-radio-on-signal)]'
                : 'bg-[var(--g-radio-surface)] border-[var(--g-radio-signal-bright)] text-[var(--g-radio-signal-bright)]'
            }`}
          >
            <Icon
              name={
                connectingLive
                  ? 'sync'
                  : emergencyMode && liveOn
                  ? 'e911_emergency'
                  : 'power_settings_new'
              }
              size={18}
              filled
              spin={connectingLive}
            />
            <span className="num-ltr">
              {connectingLive ? '...' : liveOn ? 'OFF' : 'ON'}
            </span>
          </button>

          {/* Channel & Status */}
          <button
            type="button"
            onClick={() => setConsoleOpen?.(true)}
            aria-label="فتح اللاسلكي"
            className="min-h-[44px] px-1.5 text-start flex flex-col justify-center min-w-0 max-w-[150px] sm:max-w-[210px] cursor-pointer rounded-xl"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  localSpeaking
                    ? 'bg-[var(--g-radio-emergency-bright)] animate-ping'
                    : isReceiving
                    ? 'bg-[var(--g-radio-signal-bright)] animate-ping'
                    : liveOn || receiveMode === 'all'
                    ? 'bg-[var(--g-radio-signal-bright)]'
                    : 'bg-[var(--g-yellow-border)]'
                }`}
              />
              <span className="text-xs font-bold truncate text-[var(--g-radio-text)]">
                {localSpeaking
                  ? `مباشر · ${Number(txElapsedSec || 0).toFixed(0)}ث`
                  : isReceiving && liveSpeakersLabel
                  ? liveSpeakersLabel
                  : currentChannelMeta?.shortLabel || 'اللاسلكي'}
              </span>
            </div>
            <div className="text-[11px] font-medium text-[var(--g-radio-muted)] truncate flex items-center gap-1">
              <span className="num-ltr text-[var(--g-radio-signal-bright)] font-semibold">
                {currentChannelMeta?.code || 'CH-01'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {liveOn
                  ? micMode === 'muted'
                    ? 'استقبال'
                    : activeUnits.length > 1
                    ? `متصل (${activeUnits.length})`
                    : 'متصل'
                  : 'استقبال'}
              </span>
            </div>
          </button>

          {/* Mic / PTT Button */}
          <button
            type="button"
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleQuickMicClick}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerUp}
            aria-label="المايك"
            className={`w-12 h-12 rounded-full select-none touch-none flex items-center justify-center shrink-0 border transition-colors duration-150 cursor-pointer ${
              localSpeaking
                ? 'bg-[var(--g-radio-emergency)] border-[var(--g-radio-text)] text-[var(--g-radio-text)]'
                : !liveOn
                ? 'bg-[var(--g-radio-surface)] border-[var(--g-radio-signal-border)] text-[var(--g-radio-signal-bright)]'
                : micMode === 'muted'
                ? 'bg-[var(--g-radio-surface)] border-[var(--g-radio-border)] text-[var(--g-radio-muted)]'
                : 'bg-[var(--g-radio-signal-bg)] border-[var(--g-radio-signal-bright)] text-[var(--g-radio-signal-bright)]'
            }`}
          >
            <Icon
              name={
                localSpeaking
                  ? 'mic'
                  : !liveOn
                  ? 'record_voice_over'
                  : micMode === 'muted'
                  ? 'mic_off'
                  : 'mic'
              }
              size={20}
              filled
            />
          </button>

          {mobileExpanded && !liveOn && !localSpeaking && !isReceiving && (
            <button
              type="button"
              onClick={() => setMobileExpanded(false)}
              aria-label="تصغير"
              className="md:hidden w-11 h-11 rounded-full bg-[var(--g-radio-surface)] text-[var(--g-radio-muted)] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Icon name="chevron_left" size={16} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
