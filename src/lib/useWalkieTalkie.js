import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createWalkieRealtimeChannel,
  deleteWalkieCall,
  hasPermission,
  pollWalkieChannel,
  sendWalkieLiveFrame,
  sendWalkieSignal,
  transmitWalkieCall,
  updateWalkiePresence,
} from './api.js';
import {
  IDLE_BAR_LEVELS,
  acquireRadioWakeLock,
  notifyWalkieBackgroundAlert,
  playUrgentPagerTone,
  playWalkieAudioClip,
  releaseRadioWakeLock,
  startBackgroundRadioCarrier,
  stopBackgroundRadioCarrier,
  unlockWalkieAudio,
  updateBackgroundRadioMediaSession,
} from './walkieAudio.js';
import { createLiveRadioRoomEngine } from './liveRadioEngine.js';

export const WALKIE_CHANNELS = [
  {
    id: 'security',
    code: 'CH-01',
    freq: '101.5 MHz',
    label: 'قناة الأمن والبوابة',
    shortLabel: 'الأمن والبوابة',
    icon: 'shield_person',
    accent: '#00E676',
    description: 'خط صوتي حي مباشر لأفراد الأمن، البوابة الرئيسية، استلام العربيات، ومراقب الكاميرات',
  },
  {
    id: 'warehouse',
    code: 'CH-02',
    freq: '102.0 MHz',
    label: 'المخزن والرصيف',
    shortLabel: 'المخزن والرصيف',
    icon: 'warehouse',
    accent: '#38BDF8',
    description: 'خط صوتي حي لأمين المخزن، تنزيل البضاعة، وتوفير نواقص الصالة',
  },
  {
    id: 'floor',
    code: 'CH-03',
    freq: '103.5 MHz',
    label: 'الصالة والكاشير',
    shortLabel: 'الصالة والكاشير',
    icon: 'point_of_sale',
    accent: '#FBBF24',
    description: 'خط صوتي حي لمشرفي الصالة والكاشيرية ومنسقي الممرات',
  },
  {
    id: 'emergency',
    code: 'CH-09',
    freq: '109.9 MHz',
    label: 'نداء الطوارئ العام',
    shortLabel: 'طوارئ الفرع',
    icon: 'e911_emergency',
    accent: '#FF453A',
    description: 'بث طوارئ حي يصل لجميع القنوات والأجهزة المتصلة في الفرع فوراً',
  },
];

const RADIO_CHANNEL_KEY = 'zayed_walkie_channel_v1';
const RADIO_MIC_MODE_KEY = 'zayed_walkie_mic_mode_v2';

function generateTabPeerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `peer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Lightweight event bus so App.jsx's single SSE EventSource forwards walkie events with zero extra sockets!
const sseWalkieListeners = new Set();

export function emitWalkieSseEvent(type, payload) {
  for (const fn of sseWalkieListeners) {
    try {
      fn(type, payload);
    } catch {
      // ignore
    }
  }
}

export function useWalkieTalkie({ authUser, permissions = [], onToast }) {
  const role = authUser?.role || '';
  const userId = authUser?.id || '';
  const peerIdRef = useRef('');
  if (!peerIdRef.current) {
    peerIdRef.current = generateTabPeerId();
  }
  const peerId = peerIdRef.current;

  const canUseWalkie =
    Boolean(userId) &&
    role !== 'kiosk' &&
    hasPermission(permissions, role, 'walkie:use');

  const canAllChannels =
    canUseWalkie && hasPermission(permissions, role, 'walkie:all_channels');

  const allowedChannels = useMemo(() => {
    if (!canUseWalkie) return [];
    if (canAllChannels) return WALKIE_CHANNELS;
    if (role === 'security') return WALKIE_CHANNELS.filter((c) => c.id === 'security');
    if (role === 'warehouse') return WALKIE_CHANNELS.filter((c) => c.id === 'warehouse');
    return WALKIE_CHANNELS.filter((c) => c.id === 'floor');
  }, [canUseWalkie, canAllChannels, role]);

  const defaultChannelId = useMemo(() => {
    if (allowedChannels.length === 0) return 'security';
    if (allowedChannels.some((c) => c.id === 'security')) return 'security';
    return allowedChannels[0].id;
  }, [allowedChannels]);

  // Live Channel Power State (ON = open live channel + background keep-alive; OFF = disconnected standby)
  const [liveOn, setLiveOn] = useState(false);
  const [connectingLive, setConnectingLive] = useState(false);

  // Mic Mode while LIVE ON: 'vad' (Smart Voice-Activated Live Talk) | 'open' (Continuous Open Mic) | 'muted' (Listen Live + Hold PTT to Talk)
  const [micMode, setMicModeState] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(RADIO_MIC_MODE_KEY);
      if (saved === 'vad' || saved === 'open' || saved === 'muted') return saved;
    }
    return 'vad';
  });

  const [activeChannel, setActiveChannelState] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(RADIO_CHANNEL_KEY);
      if (saved) return saved;
    }
    return 'security';
  });

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [pttOverride, setPttOverrideState] = useState(false);
  const [txElapsedSec, setTxElapsedSec] = useState(0);
  const [liveLevels, setLiveLevels] = useState(IDLE_BAR_LEVELS);
  const [activeUnits, setActiveUnits] = useState([]);
  const [engineRemoteSpeakers, setEngineRemoteSpeakers] = useState([]);
  const [meshConnectedCount, setMeshConnectedCount] = useState(0);
  const [bgKeepAliveActive, setBgKeepAliveActive] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [micWarning, setMicWarning] = useState('');
  const [serverRouteMissing, setServerRouteMissing] = useState(false);
  const [recentCalls, setRecentCalls] = useState([]);
  const [activePlaybackCall, setActivePlaybackCall] = useState(null);

  const engineRef = useRef(null);
  const txTimerRef = useRef(null);
  const seenCallIdsRef = useRef(new Set());
  const seenSignalIdsRef = useRef(new Set());
  const seenFrameKeysRef = useRef(new Set());
  const lastSinceRef = useRef('');
  const lastFrameSeqRef = useRef(undefined);
  const liveOnRef = useRef(liveOn);
  const micModeRef = useRef(micMode);
  const activeChannelRef = useRef(activeChannel);
  const supabaseRealtimeRef = useRef(null);

  liveOnRef.current = liveOn;
  micModeRef.current = micMode;
  activeChannelRef.current = activeChannel;

  const currentChannelMeta = useMemo(
    () => WALKIE_CHANNELS.find((c) => c.id === activeChannel) || WALKIE_CHANNELS[0],
    [activeChannel]
  );

  // Enforce allowed channel guard whenever role/permissions change
  useEffect(() => {
    if (!canUseWalkie || allowedChannels.length === 0) return;
    if (!allowedChannels.some((c) => c.id === activeChannel)) {
      setActiveChannelState(defaultChannelId);
    }
  }, [canUseWalkie, allowedChannels, activeChannel, defaultChannelId]);

  // Unlock WebAudio ONLY on a trusted click / touchend / keydown gesture (NEVER pointerdown -> ZERO console warnings!)
  useEffect(() => {
    if (!canUseWalkie || typeof window === 'undefined') return undefined;
    const handleTrustedGesture = () => {
      unlockWalkieAudio({ fromTrustedGesture: true });
      window.removeEventListener('click', handleTrustedGesture);
      window.removeEventListener('touchend', handleTrustedGesture);
      window.removeEventListener('keydown', handleTrustedGesture);
    };
    window.addEventListener('click', handleTrustedGesture, { passive: true });
    window.addEventListener('touchend', handleTrustedGesture, { passive: true });
    window.addEventListener('keydown', handleTrustedGesture, { passive: true });
    return () => {
      window.removeEventListener('click', handleTrustedGesture);
      window.removeEventListener('touchend', handleTrustedGesture);
      window.removeEventListener('keydown', handleTrustedGesture);
    };
  }, [canUseWalkie]);

  // Track elapsed speaking seconds when local voice is live
  useEffect(() => {
    if (!localSpeaking) {
      if (txTimerRef.current) {
        clearInterval(txTimerRef.current);
        txTimerRef.current = null;
      }
      setTxElapsedSec(0);
      return undefined;
    }
    const startedMs = Date.now();
    txTimerRef.current = setInterval(() => {
      setTxElapsedSec(Math.floor((Date.now() - startedMs) / 100) / 10);
    }, 100);
    return () => {
      if (txTimerRef.current) {
        clearInterval(txTimerRef.current);
        txTimerRef.current = null;
      }
    };
  }, [localSpeaking]);

  // Re-acquire Screen Wake Lock when returning to foreground while LIVE ON
  useEffect(() => {
    if (!canUseWalkie || !liveOn || typeof document === 'undefined') return undefined;
    const handleVis = () => {
      if (document.visibilityState === 'visible' && liveOnRef.current) {
        acquireRadioWakeLock().then((ok) => setWakeLockActive(ok));
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
  }, [canUseWalkie, liveOn]);

  const dispatchSignalOut = useCallback(
    async (sigPayload) => {
      const res = await sendWalkieSignal(sigPayload);
      if (res?.routeMissing) {
        setServerRouteMissing(true);
      } else if (res?.ok) {
        setServerRouteMissing(false);
        if (Array.isArray(res.activeUnits)) {
          setActiveUnits(res.activeUnits);
        }
      }
      try {
        supabaseRealtimeRef.current?.send({
          type: 'broadcast',
          event: 'walkie_signal',
          payload: {
            id: `${peerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            channel: sigPayload.channel,
            from_peer_id: peerId,
            target_peer_id: sigPayload.target_peer_id || '',
            user_id: userId,
            display_name: authUser?.display_name || 'الأمن',
            role,
            avatar_color: authUser?.avatar_color || '#146C2E',
            signal_type: sigPayload.signal_type,
            data: sigPayload.data ?? null,
          },
        });
      } catch {
        // ignore
      }
      return res;
    },
    [peerId, userId, authUser?.display_name, authUser?.avatar_color, role]
  );

  const dispatchLiveFrameOut = useCallback(
    async (framePayload) => {
      const res = await sendWalkieLiveFrame(framePayload);
      if (res?.routeMissing) {
        setServerRouteMissing(true);
      } else if (res?.ok) {
        setServerRouteMissing(false);
      }
      try {
        supabaseRealtimeRef.current?.send({
          type: 'broadcast',
          event: 'walkie_live_frame',
          payload: {
            channel: framePayload.channel,
            from_peer_id: peerId,
            sender_id: userId,
            sender_name: authUser?.display_name || 'الأمن',
            sender_role: role,
            sample_rate: framePayload.sample_rate || 8000,
            ulaw_b64: framePayload.ulaw_b64,
            ts_ms: Date.now(),
          },
        });
      } catch {
        // ignore
      }
    },
    [peerId, userId, authUser?.display_name, role]
  );

  const processIncomingSignal = useCallback((envelope) => {
    if (!envelope || !liveOnRef.current) return;
    if (envelope.id) {
      if (seenSignalIdsRef.current.has(envelope.id)) return;
      seenSignalIdsRef.current.add(envelope.id);
      if (seenSignalIdsRef.current.size > 400) {
        const first = seenSignalIdsRef.current.values().next().value;
        seenSignalIdsRef.current.delete(first);
      }
    }
    engineRef.current?.handleSignal(envelope);
  }, []);

  const processIncomingLiveFrame = useCallback((packet) => {
    if (!packet || !liveOnRef.current) return;
    if (packet.seq !== undefined) {
      if (
        lastFrameSeqRef.current !== undefined &&
        packet.seq <= lastFrameSeqRef.current &&
        seenFrameKeysRef.current.has(`seq_${packet.seq}`)
      ) {
        return;
      }
      seenFrameKeysRef.current.add(`seq_${packet.seq}`);
      if (lastFrameSeqRef.current === undefined || packet.seq > lastFrameSeqRef.current) {
        lastFrameSeqRef.current = packet.seq;
      }
    } else if (packet.from_peer_id && packet.ts_ms) {
      const k = `${packet.from_peer_id}_${packet.ts_ms}`;
      if (seenFrameKeysRef.current.has(k)) return;
      seenFrameKeysRef.current.add(k);
    }

    if (seenFrameKeysRef.current.size > 300) {
      const first = seenFrameKeysRef.current.values().next().value;
      seenFrameKeysRef.current.delete(first);
    }

    engineRef.current?.handleLiveFrame(packet);
  }, []);

  const runChannelPollHeartbeat = useCallback(async () => {
    if (!canUseWalkie) return;
    const ch = activeChannelRef.current;
    const isLive = liveOnRef.current;
    const res = await pollWalkieChannel({
      channel: ch,
      since: lastSinceRef.current,
      listening: isLive,
      peerId,
      liveOn: isLive,
      lastFrameSeq: isLive ? lastFrameSeqRef.current : undefined,
    });

    if (res?.routeMissing) {
      setServerRouteMissing(true);
      return;
    }
    if (!res?.ok) return;

    setServerRouteMissing(false);
    if (res.latestFrameSeq !== undefined && lastFrameSeqRef.current === undefined) {
      lastFrameSeqRef.current = res.latestFrameSeq;
    }

    if (Array.isArray(res.activeUnits)) {
      setActiveUnits(res.activeUnits);
      if (isLive) {
        engineRef.current?.syncActiveUnitsFromServer(res.activeUnits);
      }
    }

    if (isLive && Array.isArray(res.signals)) {
      for (const sig of res.signals) {
        processIncomingSignal(sig);
      }
    }

    if (isLive && Array.isArray(res.liveFrames)) {
      for (const frame of res.liveFrames) {
        processIncomingLiveFrame(frame);
      }
    }

    if (Array.isArray(res.calls) && res.calls.length > 0) {
      const hadInitialBaseline = Boolean(lastSinceRef.current);
      for (const c of res.calls) {
        const already = seenCallIdsRef.current.has(c.id);
        seenCallIdsRef.current.add(c.id);
        if (c.timestamp && (!lastSinceRef.current || c.timestamp > lastSinceRef.current)) {
          lastSinceRef.current = c.timestamp;
        }
        if (!already && hadInitialBaseline && c.sender_id !== userId && c.kind === 'ping') {
          playUrgentPagerTone();
          notifyWalkieBackgroundAlert(
            `جرس انتباه عاجل (${c.sender_name})`,
            `تنبيه فوري على ${WALKIE_CHANNELS.find((x) => x.id === c.channel)?.label || 'قناة الأمن'}`
          );
        }
      }
      setRecentCalls((prev) => {
        const merged = [...res.calls, ...prev];
        const map = new Map();
        for (const item of merged) {
          if (item?.id && !map.has(item.id)) map.set(item.id, item);
        }
        return Array.from(map.values())
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          .slice(0, 20);
      });
    } else if (res.serverTime && !lastSinceRef.current) {
      lastSinceRef.current = res.serverTime;
    }
  }, [canUseWalkie, peerId, userId, processIncomingSignal, processIncomingLiveFrame]);

  const setMicMode = useCallback((nextMode) => {
    if (!['vad', 'open', 'muted'].includes(nextMode)) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    setMicModeState(nextMode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RADIO_MIC_MODE_KEY, nextMode);
    }
    engineRef.current?.setMicMode(nextMode);
    if (liveOnRef.current) {
      updateWalkiePresence({
        channel: activeChannelRef.current,
        peer_id: peerId,
        status: 'listening',
        live_on: true,
        mic_mode: nextMode,
      });
    }
  }, [peerId]);

  const turnLiveOff = useCallback(() => {
    setLiveOn(false);
    setConnectingLive(false);
    setLocalSpeaking(false);
    setPttOverrideState(false);
    setEngineRemoteSpeakers([]);
    setMeshConnectedCount(0);
    setMicWarning('');
    setLiveLevels(IDLE_BAR_LEVELS);

    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }

    stopBackgroundRadioCarrier();
    setBgKeepAliveActive(false);
    releaseRadioWakeLock().then(() => setWakeLockActive(false));

    updateWalkiePresence({
      channel: activeChannelRef.current,
      peer_id: peerId,
      status: 'offline',
      live_on: false,
    });
  }, [peerId]);

  const startEngineForChannel = useCallback(
    async (targetChannelId) => {
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }

      const chMeta =
        WALKIE_CHANNELS.find((c) => c.id === targetChannelId) || WALKIE_CHANNELS[0];

      setConnectingLive(true);
      setMicWarning('');
      lastFrameSeqRef.current = undefined;

      // 1. Activate Background Audio Carrier + MediaSession inside the trusted click gesture!
      const carrierOk = await startBackgroundRadioCarrier({
        channelLabel: chMeta.label,
        channelCode: chMeta.code,
        onToggleMicMute: () => {
          const next = micModeRef.current === 'muted' ? 'vad' : 'muted';
          setMicMode(next);
        },
        onPowerOff: () => {
          turnLiveOff();
        },
      });
      setBgKeepAliveActive(carrierOk);

      acquireRadioWakeLock().then((ok) => setWakeLockActive(ok));

      // 2. Launch Live Multi-Peer Audio Room Engine
      const engine = createLiveRadioRoomEngine({
        peerId,
        channel: targetChannelId,
        initialMicMode: micModeRef.current,
        sendSignal: dispatchSignalOut,
        sendLiveFrame: dispatchLiveFrameOut,
        onLocalSpeakingChange: setLocalSpeaking,
        onRemoteSpeakersChange: setEngineRemoteSpeakers,
        onMeshPeersChange: setMeshConnectedCount,
        onLevels: setLiveLevels,
        onHeartbeatTick: runChannelPollHeartbeat,
        onMicWarning: (msg) => setMicWarning(msg),
      });

      engineRef.current = engine;
      setLiveOn(true);
      liveOnRef.current = true;

      await engine.start();
      setConnectingLive(false);

      // Announce live presence & pull existing peers immediately
      const presRes = await updateWalkiePresence({
        channel: targetChannelId,
        peer_id: peerId,
        status: 'listening',
        live_on: true,
        mic_mode: micModeRef.current,
      });
      if (presRes?.routeMissing) {
        setServerRouteMissing(true);
      } else if (Array.isArray(presRes?.activeUnits)) {
        setServerRouteMissing(false);
        setActiveUnits(presRes.activeUnits);
        engine.syncActiveUnitsFromServer(presRes.activeUnits);
      }
      runChannelPollHeartbeat();
    },
    [
      peerId,
      dispatchSignalOut,
      dispatchLiveFrameOut,
      runChannelPollHeartbeat,
      setMicMode,
      turnLiveOff,
    ]
  );

  const turnLiveOn = useCallback(async () => {
    if (!canUseWalkie || connectingLive) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    await startEngineForChannel(activeChannelRef.current);
  }, [canUseWalkie, connectingLive, startEngineForChannel]);

  const toggleLivePower = useCallback(async () => {
    unlockWalkieAudio({ fromTrustedGesture: true });
    if (liveOnRef.current) {
      turnLiveOff();
    } else {
      await turnLiveOn();
    }
  }, [turnLiveOff, turnLiveOn]);

  const selectChannel = useCallback(
    async (channelId) => {
      if (!allowedChannels.some((c) => c.id === channelId)) return;
      unlockWalkieAudio({ fromTrustedGesture: true });
      setActiveChannelState(channelId);
      activeChannelRef.current = channelId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(RADIO_CHANNEL_KEY, channelId);
      }
      if (liveOnRef.current) {
        await startEngineForChannel(channelId);
      }
    },
    [allowedChannels, startEngineForChannel]
  );

  // Instant Hold-to-Talk Override (works when Mic is Muted or VAD, or turns Live ON if currently OFF!)
  const startTransmit = useCallback(async () => {
    if (!canUseWalkie) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    if (!liveOnRef.current) {
      await turnLiveOn();
    }
    setPttOverrideState(true);
    engineRef.current?.setPttPressed(true);
  }, [canUseWalkie, turnLiveOn]);

  const stopTransmit = useCallback(() => {
    setPttOverrideState(false);
    engineRef.current?.setPttPressed(false);
  }, []);

  const cancelTransmit = stopTransmit;

  // Subscribe to SSE walkie events forwarded from App.jsx
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    const listener = (type, payload) => {
      if (type === 'walkie_signal' && payload) {
        processIncomingSignal(payload);
      } else if (type === 'walkie_live_frame' && payload) {
        processIncomingLiveFrame(payload);
      } else if (type === 'walkie_presence' && Array.isArray(payload?.activeUnits)) {
        if (!payload.channel || payload.channel === activeChannelRef.current) {
          setActiveUnits(payload.activeUnits);
          if (liveOnRef.current) {
            engineRef.current?.syncActiveUnitsFromServer(payload.activeUnits);
          }
        }
      } else if (type === 'walkie_tx' && payload?.call) {
        const call = payload.call;
        const already = seenCallIdsRef.current.has(call.id);
        seenCallIdsRef.current.add(call.id);
        setRecentCalls((prev) => {
          if (prev.some((c) => c.id === call.id)) return prev;
          return [call, ...prev].slice(0, 20);
        });
        if (!already && call.sender_id !== userId) {
          if (call.kind === 'ping') {
            playUrgentPagerTone();
            notifyWalkieBackgroundAlert(
              `جرس انتباه عاجل (${call.sender_name})`,
              `تنبيه فوري على ${currentChannelMeta.label}`
            );
          } else if (call.audio_data && liveOnRef.current) {
            playWalkieAudioClip(call.audio_data, {
              onLevel: setLiveLevels,
              withRadioEffects: true,
            });
          }
        }
      }
    };
    sseWalkieListeners.add(listener);
    return () => sseWalkieListeners.delete(listener);
  }, [
    canUseWalkie,
    userId,
    currentChannelMeta.label,
    processIncomingSignal,
    processIncomingLiveFrame,
  ]);

  // Optional Supabase Realtime Broadcast channel for cloud relay across phones
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    const rt = createWalkieRealtimeChannel('zayed_walkie_live_v2');
    if (!rt) return undefined;

    supabaseRealtimeRef.current = rt.channel;
    rt.channel
      .on('broadcast', { event: 'walkie_signal' }, ({ payload }) => {
        if (payload) processIncomingSignal(payload);
      })
      .on('broadcast', { event: 'walkie_live_frame' }, ({ payload }) => {
        if (payload) processIncomingLiveFrame(payload);
      })
      .on('broadcast', { event: 'walkie_tx' }, ({ payload }) => {
        if (payload?.call && payload.call.sender_id !== userId && payload.call.kind === 'ping') {
          playUrgentPagerTone();
        }
      })
      .subscribe();

    return () => {
      supabaseRealtimeRef.current = null;
      try {
        rt.supabase.removeChannel(rt.channel);
      } catch {
        // ignore
      }
    };
  }, [canUseWalkie, userId, processIncomingSignal, processIncomingLiveFrame]);

  // Lightweight standby poll (when OFF, checks every 10s-15s just for unit count & call log; when LIVE ON, Worker drives fast ticks)
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    runChannelPollHeartbeat();

    if (liveOn) return undefined;
    const standbyIntervalMs = serverRouteMissing ? 15000 : 10000;
    const timer = setInterval(() => {
      runChannelPollHeartbeat();
    }, standbyIntervalMs);
    return () => clearInterval(timer);
  }, [canUseWalkie, activeChannel, liveOn, serverRouteMissing, runChannelPollHeartbeat]);

  const sendAlertPing = useCallback(async () => {
    if (!canUseWalkie) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    playUrgentPagerTone();
    try {
      const res = await transmitWalkieCall({
        channel: activeChannelRef.current,
        peer_id: peerId,
        kind: 'ping',
        is_emergency: true,
      });
      if (res?.call) {
        seenCallIdsRef.current.add(res.call.id);
        setRecentCalls((prev) => [res.call, ...prev.filter((c) => c.id !== res.call.id)].slice(0, 20));
        try {
          supabaseRealtimeRef.current?.send({
            type: 'broadcast',
            event: 'walkie_tx',
            payload: { call: res.call },
          });
        } catch {
          // ignore
        }
      }
      onToast?.('تم إرسال جرس انتباه لاسلكي عاجل لجميع المتصلين على القناة');
    } catch (err) {
      onToast?.(err.message || 'تعذر إرسال جرس الانتباه', 'error');
    }
  }, [canUseWalkie, peerId, onToast]);

  const replayCall = useCallback(async (call) => {
    if (!call) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    setActivePlaybackCall(call);
    if (call.kind === 'ping') {
      playUrgentPagerTone();
      await new Promise((r) => setTimeout(r, 800));
    } else if (call.audio_data) {
      await playWalkieAudioClip(call.audio_data, {
        onLevel: setLiveLevels,
        withRadioEffects: true,
      });
    }
    setActivePlaybackCall(null);
  }, []);

  const removeCall = useCallback(
    async (callId) => {
      try {
        await deleteWalkieCall(callId);
        setRecentCalls((prev) => prev.filter((c) => c.id !== callId));
      } catch (err) {
        onToast?.(err.message || 'تعذر حذف النداء', 'error');
      }
    },
    [onToast]
  );

  // Clean shutdown on logout / unmount
  useEffect(() => {
    return () => {
      if (txTimerRef.current) clearInterval(txTimerRef.current);
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
      stopBackgroundRadioCarrier();
      releaseRadioWakeLock();
    };
  }, []);

  // Deduplicated list of all colleagues speaking right now simultaneously!
  const liveSpeakingUnits = useMemo(() => {
    const map = new Map();
    for (const s of engineRemoteSpeakers) {
      if (s.peer_id && s.peer_id !== peerId) {
        map.set(s.peer_id, s);
      }
    }
    for (const u of activeUnits) {
      const uPeer = u.peer_id || u.user_id;
      if (uPeer && uPeer !== peerId && u.status === 'talking' && !map.has(uPeer)) {
        map.set(uPeer, {
          peer_id: uPeer,
          user_id: u.user_id,
          display_name: u.display_name,
          role: u.role,
        });
      }
    }
    return Array.from(map.values());
  }, [engineRemoteSpeakers, activeUnits, peerId]);

  // Keep lock-screen MediaSession updated with active speaker names in background!
  useEffect(() => {
    if (!liveOn) return;
    const names = liveSpeakingUnits.map((u) => u.display_name).filter(Boolean);
    const speakerText = localSpeaking
      ? 'أنت تتحدث الآن على الخط الحي...'
      : names.length > 0
      ? `يتحدث الآن: ${names.join(' + ')}`
      : micMode === 'muted'
      ? 'المايك مكتوم — الاستماع الحي نشط بالخلفية'
      : 'الخط الحي مفتوح بالخلفية — تكلم في أي وقت';

    updateBackgroundRadioMediaSession({
      channelLabel: currentChannelMeta.label,
      channelCode: currentChannelMeta.code,
      speakerText,
      onToggleMicMute: () => {
        setMicMode(micModeRef.current === 'muted' ? 'vad' : 'muted');
      },
      onPowerOff: turnLiveOff,
    });
  }, [liveOn, localSpeaking, liveSpeakingUnits, micMode, currentChannelMeta, setMicMode, turnLiveOff]);

  const pttState = connectingLive
    ? 'connecting'
    : localSpeaking
    ? 'transmitting'
    : liveSpeakingUnits.length > 0 || Boolean(activePlaybackCall)
    ? 'receiving'
    : 'idle';

  return {
    peerId,
    canUseWalkie,
    canAllChannels,
    allowedChannels,
    activeChannel,
    currentChannelMeta,
    selectChannel,
    // Live Power & Background Controls
    liveOn,
    connectingLive,
    toggleLivePower,
    turnLiveOn,
    turnLiveOff,
    radioEnabled: liveOn,
    setRadioEnabled: (val) => {
      const next = typeof val === 'function' ? val(liveOn) : Boolean(val);
      if (next) turnLiveOn();
      else turnLiveOff();
    },
    // Mic Mode & Instant PTT Override
    micMode,
    setMicMode,
    pttOverride,
    localSpeaking,
    pttState,
    txElapsedSec,
    liveLevels,
    // Peers & Simultaneous Speakers
    activeUnits,
    liveSpeakingUnits,
    remoteTalkingUnit: liveSpeakingUnits[0] || null,
    meshConnectedCount,
    bgKeepAliveActive,
    wakeLockActive,
    micWarning,
    serverRouteMissing,
    // Console & Call History / Pager
    consoleOpen,
    setConsoleOpen,
    recentCalls,
    activePlaybackCall,
    startTransmit,
    stopTransmit,
    cancelTransmit,
    sendAlertPing,
    replayCall,
    removeCall,
  };
}
