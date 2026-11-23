import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTimeArabic } from '../lib/exportUtils.js';
import { ROLE_ARABIC_SHORT } from '../lib/navigation.js';
import { popModalLayer, pushModalLayer } from './ui/BottomSheet.jsx';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  GroupedList,
  Icon,
  SegmentedControl,
  StatusDot,
} from './ui/index.js';

const MIC_MODES = [
  { id: 'vad', labelAr: 'تلقائي' },
  { id: 'open', labelAr: 'مفتوح' },
  { id: 'muted', labelAr: 'اضغط للتحدث' },
];

const RECEIVE_MODES = [
  { id: 'all', labelAr: 'الكل' },
  { id: 'emergency_only', labelAr: 'طوارئ' },
  { id: 'muted', labelAr: 'كتم' },
];

export default function WalkieTalkieConsole({
  open,
  onClose,
  walkie,
  authUser,
  canManageRecords = false,
}) {
  const activePointerIdRef = useRef(null);
  const didHoldTransmitRef = useRef(false);

  const {
    peerId,
    canAllChannels = false,
    allowedChannels = [],
    activeChannel,
    currentChannelMeta = {},
    selectChannel,
    liveOn,
    connectingLive,
    toggleLivePower,
    turnLiveOn,
    receiveMode = 'all',
    setReceiveMode,
    emergencyMode = false,
    setEmergencyMode,
    micMode,
    setMicMode,
    localSpeaking,
    pttOverride,
    txElapsedSec = 0,
    liveLevels = [],
    activeUnits = [],
    channelActivitySummary = {},
    liveSpeakingUnits = [],
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
  } = walkie || {};

  const hasMultiChannels = allowedChannels.length > 1;
  const [activeTab, setActiveTab] = useState(hasMultiChannels ? 'channels' : 'modes');
  const [pingCooldownSec, setPingCooldownSec] = useState(0);
  const [deletingCall, setDeletingCall] = useState(null);
  const [layerZ, setLayerZ] = useState(62);

  const isReceiving = liveSpeakingUnits.length > 0 || Boolean(activePlaybackCall);

  useEffect(() => {
    if (!open) return undefined;
    const z = pushModalLayer();
    setLayerZ(z);
    return () => {
      popModalLayer();
    };
  }, [open]);

  useEffect(() => {
    if (!hasMultiChannels && activeTab === 'channels') {
      setActiveTab('modes');
    }
  }, [hasMultiChannels, activeTab]);

  useEffect(() => {
    if (pingCooldownSec <= 0) return undefined;
    const t = setTimeout(() => {
      setPingCooldownSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(t);
  }, [pingCooldownSec]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (deletingCall) return;
        if (pttOverride) {
          cancelTransmit?.();
        }
        onClose?.();
        return;
      }

      if (e.code !== 'Space' || e.repeat) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      e.preventDefault();
      startTransmit?.();
    };

    const handleKeyUp = (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      e.preventDefault();
      stopTransmit?.();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [open, pttOverride, deletingCall, onClose, startTransmit, stopTransmit, cancelTransmit]);

  if (!open) return null;

  function handleCenterButtonClick() {
    if (didHoldTransmitRef.current) {
      didHoldTransmitRef.current = false;
      return;
    }
    if (!liveOn) {
      turnLiveOn?.();
    }
  }

  function handlePttPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    didHoldTransmitRef.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      activePointerIdRef.current = e.pointerId;
    } catch {
      // ignore
    }
    startTransmit?.();
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
    stopTransmit?.();
  }

  function handleAlertPingClick() {
    if (pingCooldownSec > 0) return;
    sendAlertPing?.();
    setPingCooldownSec(3);
  }

  const speakingNamesBanner = activePlaybackCall
    ? activePlaybackCall.sender_name
    : liveSpeakingUnits
        .map((u) => u.display_name)
        .filter(Boolean)
        .join(' · ');

  const speakingPeerIds = new Set(liveSpeakingUnits.map((u) => u.peer_id));

  const consoleTabOptions = [
    ...(hasMultiChannels
      ? [{ id: 'channels', labelAr: `القنوات (${allowedChannels.length})` }]
      : []),
    {
      id: 'modes',
      labelAr: recentCalls.length > 0 ? `الأوضاع (${recentCalls.length})` : 'الأوضاع',
    },
  ];

  const consoleNode = (
    <div
      onClick={() => {
        if (!pttOverride && !deletingCall) onClose?.();
      }}
      style={{ zIndex: layerZ }}
      className="g-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="اللاسلكي"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="g-dialog-sheet max-w-lg animate-pop space-y-3.5"
      >
        <div className="g-sheet-handle" />

        {/* 1. Concise Header */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base sm:text-lg font-semibold text-ink m-0 truncate">
            اللاسلكي
          </h2>

          <button
            type="button"
            onClick={() => {
              if (pttOverride) cancelTransmit?.();
              onClose?.();
            }}
            aria-label="إغلاق"
            className="w-11 h-11 rounded-full bg-surface-2 hover:border-line-strong border border-line text-ink flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {serverRouteMissing && (
          <StatusDot tone="warning" tintedText label="يرجى تحديث الخادم للبث الحي" />
        )}

        {micWarning && liveOn && (
          <StatusDot tone="neutral" label={micWarning} />
        )}

        {/* 2. OLED Radio Console + PTT Circle */}
        <div
          className={`rounded-3xl border p-4 space-y-3.5 transition-colors duration-200 text-[var(--g-radio-text)] ${
            emergencyMode && liveOn
              ? 'bg-[var(--g-radio-emergency-bg)] border-[var(--g-radio-emergency-bright)]'
              : liveOn
              ? 'bg-[var(--g-radio-bg)] border-[var(--g-radio-signal-bright)]'
              : 'bg-[var(--g-radio-bg)] border-[var(--g-radio-border)]'
          }`}
        >
          {/* Channel & Status Row */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="num-ltr text-xs font-bold text-[var(--g-radio-signal-bright)]">
                  {currentChannelMeta.code || 'CH-01'} · {currentChannelMeta.freq || '462.5625 MHz'}
                </span>
                {emergencyMode && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--g-radio-emergency-bright)] text-[var(--g-radio-text)]">
                    طوارئ
                  </span>
                )}
              </div>
              <div className="text-sm sm:text-base font-bold text-[var(--g-radio-text)] truncate mt-0.5">
                {currentChannelMeta.shortLabel || currentChannelMeta.label || 'القناة النشطة'}
              </div>
            </div>

            <div className="text-xs font-semibold shrink-0">
              {localSpeaking ? (
                <span className="num-ltr text-[var(--g-radio-emergency-text)]">
                  مباشر · {Number(txElapsedSec).toFixed(1)}s
                </span>
              ) : isReceiving ? (
                <span className="text-[var(--g-radio-signal-bright)]">
                  استقبال ({liveSpeakingUnits.length || 1})
                </span>
              ) : liveOn ? (
                <span className="text-[var(--g-radio-signal-bright)]">نشط</span>
              ) : (
                <span className="text-[var(--g-radio-muted)]">استقبال</span>
              )}
            </div>
          </div>

          {/* Speaker Strip + 12-Bar Visualizer */}
          <div className="rounded-2xl bg-[var(--g-radio-surface)] border border-[var(--g-radio-border)] px-3 py-2 flex items-center justify-between gap-2.5 min-h-[44px]">
            <div className="min-w-0 flex-1 text-xs font-medium truncate">
              {localSpeaking && speakingNamesBanner ? (
                <span className="text-[var(--g-yellow-border)]">
                  أنت · {speakingNamesBanner}
                </span>
              ) : localSpeaking ? (
                <span className="text-[var(--g-radio-emergency-text)]">مباشر</span>
              ) : speakingNamesBanner ? (
                <span className="text-[var(--g-radio-signal-bright)]">
                  {speakingNamesBanner}
                </span>
              ) : (
                <span className="text-[var(--g-radio-muted)]">
                  {liveOn ? 'الخط مفتوح' : 'جاهز'}
                </span>
              )}
            </div>

            <div aria-hidden="true" className="flex items-center gap-1 h-7 shrink-0 px-0.5">
              {liveLevels.map((lvl, idx) => (
                <span
                  key={idx}
                  style={{
                    transform: `scaleY(${Math.max(0.14, Math.min(1, lvl))})`,
                    backgroundColor: localSpeaking
                      ? 'var(--g-radio-emergency-bright)'
                      : isReceiving
                      ? 'var(--g-radio-signal-bright)'
                      : liveOn
                      ? 'var(--g-radio-signal)'
                      : 'var(--g-radio-border)',
                  }}
                  className="w-1.5 h-6 rounded-full origin-center transition-transform duration-75 will-change-transform"
                />
              ))}
            </div>
          </div>

          {/* Central PTT Circle */}
          <div className="flex flex-col items-center justify-center gap-3 py-1">
            <div className="relative flex items-center justify-center">
              {localSpeaking && (
                <>
                  <span className="absolute inset-0 rounded-full bg-[var(--g-radio-emergency-bright)] opacity-35 walkie-pulse-ring pointer-events-none" />
                  <span
                    style={{ animationDelay: '0.45s' }}
                    className="absolute inset-0 rounded-full bg-[var(--g-radio-emergency)] opacity-25 walkie-pulse-ring pointer-events-none"
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
                aria-label="اضغط للتحدث"
                className={`relative z-10 w-36 h-36 sm:w-40 sm:h-40 rounded-full select-none touch-none flex flex-col items-center justify-center gap-1.5 border-4 transition-[transform,background-color,border-color] duration-150 cursor-pointer ${
                  localSpeaking
                    ? 'bg-[var(--g-radio-emergency)] border-[var(--g-radio-emergency-text)] text-[var(--g-radio-text)] scale-96'
                    : emergencyMode
                    ? 'bg-[var(--g-radio-emergency-bg)] border-[var(--g-radio-emergency-bright)] text-[var(--g-radio-text)]'
                    : !liveOn
                    ? 'bg-[var(--g-radio-surface)] hover:bg-[var(--g-radio-surface-2)] border-[var(--g-radio-signal-bright)] text-[var(--g-radio-signal-bright)]'
                    : micMode === 'muted'
                    ? 'bg-[var(--g-radio-surface-2)] border-[var(--g-radio-muted)] text-[var(--g-radio-text)]'
                    : 'bg-[var(--g-radio-signal-bg)] border-[var(--g-radio-signal-bright)] text-[var(--g-radio-text)]'
                }`}
              >
                <Icon
                  name={
                    localSpeaking
                      ? 'mic'
                      : emergencyMode
                      ? 'e911_emergency'
                      : !liveOn || micMode === 'muted'
                      ? 'touch_app'
                      : 'graphic_eq'
                  }
                  size={36}
                  filled
                />
                <span className="text-xs sm:text-sm font-bold text-center px-2">
                  {localSpeaking
                    ? 'مباشر الآن'
                    : !liveOn || micMode === 'muted'
                    ? 'اضغط للتحدث'
                    : 'مباشر'}
                </span>
                {localSpeaking && (
                  <span className="text-[11px] font-semibold opacity-85 num-ltr">
                    {Number(txElapsedSec).toFixed(1)}s
                  </span>
                )}
              </button>
            </div>

            {/* Power, Emergency & Ping Controls */}
            <div className="grid grid-cols-2 gap-2 w-full">
              <button
                type="button"
                onClick={toggleLivePower}
                disabled={connectingLive}
                className={`min-h-[44px] px-3 py-2 rounded-[var(--g-radius-md)] font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer ${
                  liveOn
                    ? 'bg-[var(--g-radio-emergency)] text-[var(--g-radio-text)]'
                    : 'bg-[var(--g-radio-signal-bright)] text-[var(--g-radio-on-signal)]'
                }`}
              >
                <Icon name="power_settings_new" size={18} filled />
                <span>
                  {connectingLive
                    ? 'جاري الفتح...'
                    : liveOn
                    ? 'إنهاء الجلسة'
                    : 'فتح الجلسة'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setEmergencyMode?.((prev) => !prev)}
                className={`min-h-[44px] px-3 py-2 rounded-[var(--g-radius-md)] border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  emergencyMode
                    ? 'bg-[var(--g-radio-emergency-bright)] text-[var(--g-radio-text)] border-[var(--g-radio-text)]'
                    : 'bg-[var(--g-radio-surface)] text-[var(--g-radio-text)] border-[var(--g-radio-border)]'
                }`}
              >
                <Icon name="e911_emergency" size={16} filled />
                <span>طوارئ</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleAlertPingClick}
              disabled={pingCooldownSec > 0}
              className="w-full min-h-[44px] px-3 py-2 rounded-[var(--g-radius-md)] bg-[var(--g-radio-emergency-bg)] text-[var(--g-radio-emergency-text)] border border-[var(--g-radio-emergency-bright)] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
            >
              <Icon name="notifications_active" size={16} filled />
              <span>
                {pingCooldownSec > 0 ? `انتظر (${pingCooldownSec}ث)` : 'صافرة طوارئ'}
              </span>
            </button>
          </div>

          {/* 1 Quiet Status Dot + Connected Count + Units */}
          <div className="pt-2 border-t border-[var(--g-radio-border)] flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 text-[var(--g-radio-signal-bright)] font-semibold shrink-0">
              <span
                className="w-2 h-2 rounded-full bg-[var(--g-radio-signal-bright)]"
                aria-hidden="true"
              />
              <span className="num-ltr">متصل ({activeUnits.length})</span>
            </span>

            {activeUnits.slice(0, 6).map((u) => {
              const uKey = u.peer_id || u.user_id;
              const isMe = u.peer_id ? u.peer_id === peerId : u.user_id === authUser?.id;
              const isUnitTalking =
                (isMe && localSpeaking) ||
                u.status === 'talking' ||
                speakingPeerIds.has(uKey);
              return (
                <span
                  key={uKey}
                  className={`text-[11px] font-medium truncate max-w-[100px] ${
                    isUnitTalking
                      ? 'text-[var(--g-radio-emergency-text)] font-bold'
                      : 'text-[var(--g-radio-muted)]'
                  }`}
                >
                  {isMe ? 'أنت' : u.display_name}
                </span>
              );
            })}
            {activeUnits.length > 6 && (
              <span className="num-ltr text-[11px] text-[var(--g-radio-muted)]">
                +{activeUnits.length - 6}
              </span>
            )}
          </div>
        </div>

        {/* 3. Segmented Tab Switcher */}
        {consoleTabOptions.length > 1 && (
          <SegmentedControl
            options={consoleTabOptions}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="أقسام اللاسلكي"
            fullWidth
          />
        )}

        {/* TAB A: Channels */}
        {activeTab === 'channels' && hasMultiChannels && (
          <div className="space-y-2.5">
            {!canAllChannels &&
              activeChannel !== 'security' &&
              allowedChannels.some((c) => c.id === 'security') && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon="shield_person"
                    onClick={() => selectChannel?.('security')}
                  >
                    الأمن CH-01
                  </Button>
                </div>
              )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {allowedChannels.map((ch) => {
                const selected = ch.id === activeChannel;
                const chSummary = channelActivitySummary?.[ch.id] || {
                  count: selected ? activeUnits.length : 0,
                  talkingCount: 0,
                  talkingNames: [],
                };
                const isChTalking = chSummary.talkingCount > 0;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => selectChannel?.(ch.id)}
                    className={`min-h-[54px] px-3 py-2 rounded-[var(--g-radius-md)] border text-start flex flex-col justify-between gap-1 cursor-pointer ${
                      selected
                        ? ch.id === 'emergency'
                          ? 'bg-[var(--g-radio-emergency-bg)] text-[var(--g-radio-text)] border-[var(--g-radio-emergency-bright)]'
                          : 'bg-[var(--g-radio-bg)] text-[var(--g-radio-text)] border-[var(--g-radio-signal-bright)]'
                        : isChTalking
                        ? 'bg-[var(--g-radio-bg)] text-[var(--g-radio-text)] border-[var(--g-radio-signal-bright)]'
                        : 'bg-surface text-ink border-line hover:border-line-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 w-full">
                      <span className="text-xs font-semibold truncate">
                        {ch.shortLabel}
                      </span>
                      {chSummary.count > 0 && (
                        <span className="text-[11px] font-semibold num-ltr opacity-85">
                          {chSummary.count}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] truncate opacity-75">
                      {isChTalking
                        ? chSummary.talkingNames?.[0] || 'يتحدث'
                        : ch.code || ch.freq}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB B: Receive / Mic Modes & Recent Calls */}
        {activeTab === 'modes' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-ink-muted">الاستقبال</div>
              <SegmentedControl
                options={RECEIVE_MODES}
                value={receiveMode}
                onChange={(v) => setReceiveMode?.(v)}
                ariaLabel="وضع الاستقبال"
                fullWidth
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-ink-muted">المايك</div>
              <SegmentedControl
                options={MIC_MODES}
                value={micMode}
                onChange={(v) => setMicMode?.(v)}
                ariaLabel="وضع المايك"
                fullWidth
              />
            </div>

            {recentCalls.length === 0 ? (
              <EmptyState compact title="لا توجد نداءات" />
            ) : (
              <GroupedList label="السجل" count={recentCalls.length}>
                {recentCalls.map((call) => {
                  const isPlayingThis = activePlaybackCall?.id === call.id;
                  const isMine = call.sender_id === authUser?.id;
                  const roleText = ROLE_ARABIC_SHORT[call.sender_role] || call.sender_role;

                  return (
                    <div
                      key={call.id}
                      className="px-3 py-2.5 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => replayCall?.(call)}
                          aria-label={`تشغيل ${call.sender_name}`}
                          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer ${
                            isPlayingThis
                              ? 'bg-success-solid text-on-success'
                              : call.kind === 'ping' || call.is_emergency
                              ? 'bg-danger-solid text-on-danger'
                              : 'bg-primary-solid text-on-primary'
                          }`}
                        >
                          <Icon
                            name={
                              isPlayingThis
                                ? 'graphic_eq'
                                : call.kind === 'ping'
                                ? 'notifications_active'
                                : 'play_arrow'
                            }
                            size={18}
                            filled
                          />
                        </button>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                              {call.sender_name}
                            </span>
                            {roleText && (
                              <span className="text-xs text-ink-muted">{roleText}</span>
                            )}
                            {Boolean(call.is_emergency) && (
                              <StatusDot tone="danger" tintedText label="طوارئ" />
                            )}
                          </div>
                          <div className="text-xs text-ink-muted num-ltr">
                            {call.kind === 'ping'
                              ? 'صافرة'
                              : `${Number(call.duration_sec || 1).toFixed(1)}ث`}
                            {' · '}
                            {formatTimeArabic(call.timestamp)}
                          </div>
                        </div>
                      </div>

                      {(isMine || canManageRecords) && (
                        <button
                          type="button"
                          onClick={() => setDeletingCall(call)}
                          aria-label="حذف"
                          className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <Icon name="delete" size={18} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </GroupedList>
            )}
          </div>
        )}
      </div>

      <ConfirmSheet
        open={Boolean(deletingCall)}
        onClose={() => setDeletingCall(null)}
        onConfirm={() => {
          if (deletingCall) {
            removeCall?.(deletingCall.id);
            setDeletingCall(null);
          }
        }}
        title="حذف النداء"
        description={deletingCall ? `حذف نداء ${deletingCall.sender_name}؟` : ''}
        confirmLabel="حذف"
        tone="danger"
      />
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(consoleNode, document.body)
    : consoleNode;
}
