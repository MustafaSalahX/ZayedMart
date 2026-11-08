import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  ensureAudioPipelineResumed,
  notifyWalkieBackgroundAlert,
  playIncomingLiveMuLawFrame,
  playIncomingRxChirp,
  playPoliceEmergencySiren,
  playUrgentPagerTone,
  playWalkieAudioClip,
  releaseRadioWakeLock,
  requestWalkieNotificationPermission,
  startBackgroundRadioCarrier,
  stopBackgroundRadioCarrier,
  unlockWalkieAudio,
  updateBackgroundRadioMediaSession,
} from './walkieAudio.js';
import { createLiveRadioRoomEngine } from './liveRadioEngine.js';
import { joinGlobalWalkieRoom } from './supabaseRealtime.js';

export const WALKIE_CHANNELS = [
  {
    id: 'security',
    code: 'CH-01',
    freq: '101.5 MHz',
    label: 'قناة الأمن والبوابة',
    shortLabel: 'الأمن CH-01',
    icon: 'shield_person',
    accent: '#00E676',
    roleBadge: 'الأمن + جميع الأقسام',
    description: 'خط لاسلكي مباشر للتواصل الفوري مع أفراد الأمن والبوابة من أي قسم أو كاشير',
  },
  {
    id: 'cashier',
    code: 'CH-02',
    freq: '102.0 MHz',
    label: 'قناة الكاشيرية وخدمة العملاء',
    shortLabel: 'الكاشير CH-02',
    icon: 'point_of_sale',
    accent: '#F87171',
    roleBadge: 'الكاشيرية',
    description: 'قناة متخصصة للكاشيرية، استعلامات الأسعار، الفكة، ومشرف الكاشير',
  },
  {
    id: 'floor',
    code: 'CH-03',
    freq: '103.5 MHz',
    label: 'قناة الصالة والممرات',
    shortLabel: 'الصالة CH-03',
    icon: 'shopping_basket',
    accent: '#FBBF24',
    roleBadge: 'منسقي الصالة',
    description: 'قناة متخصصة لمنسقي الصالة والممرات وتجهيز الرفوف والنواقص',
  },
  {
    id: 'warehouse',
    code: 'CH-04',
    freq: '104.2 MHz',
    label: 'قناة المخزن والرصيف',
    shortLabel: 'المخزن CH-04',
    icon: 'warehouse',
    accent: '#38BDF8',
    roleBadge: 'أمين المخزن',
    description: 'قناة متخصصة لأمناء المخزن، تنزيل عربيات البضاعة، وتزويد الصالة',
  },
  {
    id: 'delivery',
    code: 'CH-05',
    freq: '105.8 MHz',
    label: 'قناة الدليفري والتوصيل',
    shortLabel: 'الدليفري CH-05',
    icon: 'two_wheeler',
    accent: '#FB923C',
    roleBadge: 'الدليفري والطيارين',
    description: 'قناة متخصصة لطيارين الدليفري، تجهيز الأوردرات الخارجية، ومتابعة التوصيل',
  },
  {
    id: 'supervisor',
    code: 'CH-06',
    freq: '106.4 MHz',
    label: 'قناة المشرفين والإدارة',
    shortLabel: 'المشرفين CH-06',
    icon: 'manage_accounts',
    accent: '#A78BFA',
    roleBadge: 'الإدارة والكاميرات',
    description: 'قناة متخصصة للمدير، مشرفي الفرع، ومراقب الكاميرات',
  },
  {
    id: 'emergency',
    code: 'CH-09',
    freq: '109.9 MHz',
    label: 'نداء الطوارئ العام للكل',
    shortLabel: 'الطوارئ CH-09',
    icon: 'e911_emergency',
    accent: '#FF453A',
    roleBadge: 'عام لجميع الأدوار',
    description: 'بث طوارئ عام يخترق جميع القنوات ويُسمع تلقائياً لدى كل الأجهزة المتصلة فوراً',
  },
];

function getPrimaryChannelForRoleClient(role) {
  switch (role) {
    case 'security':
      return 'security';
    case 'cashier':
      return 'cashier';
    case 'warehouse':
      return 'warehouse';
    case 'delivery':
      return 'delivery';
    case 'owner':
    case 'manager':
    case 'supervisor':
    case 'cctv':
      return 'supervisor';
    case 'hall':
    default:
      return 'floor';
  }
}

const RADIO_CHANNEL_KEY = 'zayed_walkie_channel_v1';
const RADIO_MIC_MODE_KEY = 'zayed_walkie_mic_mode_v2';
const RADIO_RECEIVE_MODE_KEY = 'zayed_walkie_receive_mode_v1';

function generateTabPeerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `peer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function mergePresenceUnits(cloudUnits = [], serverUnits = []) {
  const byPeer = new Map();
  for (const u of serverUnits) {
    const key = u?.peer_id || u?.user_id;
    if (key) byPeer.set(key, u);
  }
  // Global Supabase Realtime WebSocket Presence is fresher (<50ms) across 4G/Wi-Fi networks
  for (const u of cloudUnits) {
    const key = u?.peer_id || u?.user_id;
    if (key) {
      const prev = byPeer.get(key) || {};
      byPeer.set(key, { ...prev, ...u });
    }
  }
  const list = Array.from(byPeer.values());
  list.sort((a, b) => {
    if (a.status === 'talking' && b.status !== 'talking') return -1;
    if (b.status === 'talking' && a.status !== 'talking') return 1;
    if (a.live_on && !b.live_on) return -1;
    if (b.live_on && !a.live_on) return 1;
    return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ar');
  });
  return list;
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
    const primaryId = getPrimaryChannelForRoleClient(role);
    const allowedIds = new Set([primaryId, 'security', 'emergency']);
    return WALKIE_CHANNELS.filter((c) => allowedIds.has(c.id));
  }, [canUseWalkie, canAllChannels, role]);

  const defaultChannelId = useMemo(() => {
    if (allowedChannels.length === 0) return 'security';
    const primaryId = getPrimaryChannelForRoleClient(role);
    if (allowedChannels.some((c) => c.id === primaryId)) return primaryId;
    if (allowedChannels.some((c) => c.id === 'security')) return 'security';
    return allowedChannels[0].id;
  }, [allowedChannels, role]);

  const [liveOn, setLiveOn] = useState(false);
  const [connectingLive, setConnectingLive] = useState(false);
  const [emergencyMode, setEmergencyModeState] = useState(false);

  // Police Radio Auto-Receive Mode:
  // 'all' = يسمع كل نداءات القناة والطوارئ تلقائياً بمجرد اتصاله بالإنترنت حتى بدون فتح اللاسلكي (الوضع الافتراضي كالشرطة)
  // 'emergency_only' = يسمع نداءات الطوارئ فقط بصوت عالٍ تلقائياً ويكتم المحادثات العادية
  // 'muted' = تنبيه مرئي وإشعار فقط للمحادثات العادية، مع اختراق صوتي للطوارئ القصوى
  const [receiveMode, setReceiveModeState] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(RADIO_RECEIVE_MODE_KEY);
      if (saved === 'all' || saved === 'emergency_only' || saved === 'muted') return saved;
    }
    return 'all';
  });

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
      if (saved && saved !== 'emergency') return saved;
    }
    return 'security';
  });

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [pttOverride, setPttOverrideState] = useState(false);
  const [txElapsedSec, setTxElapsedSec] = useState(0);
  const [liveLevels, setLiveLevels] = useState(IDLE_BAR_LEVELS);
  const [activeUnits, setActiveUnits] = useState([]);
  const [channelActivitySummary, setChannelActivitySummary] = useState({});
  const [globalCloudConnected, setGlobalCloudConnected] = useState(false);
  const [engineRemoteSpeakers, setEngineRemoteSpeakers] = useState([]);
  const [standbyRemoteSpeakers, setStandbyRemoteSpeakers] = useState([]);
  const [incomingDispatchAlert, setIncomingDispatchAlert] = useState(null);
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
  const seenDispatchIdsRef = useRef(new Set());
  const lastSinceRef = useRef('');
  const lastFrameSeqRef = useRef(undefined);
  const liveOnRef = useRef(liveOn);
  const micModeRef = useRef(micMode);
  const receiveModeRef = useRef(receiveMode);
  const emergencyModeRef = useRef(emergencyMode);
  const activeChannelRef = useRef(activeChannel);
  const globalRoomRef = useRef(null);
  const cloudUnitsRef = useRef([]);
  const serverUnitsRef = useRef([]);
  const standbySpeakersMapRef = useRef(new Map());
  const lastLiveFramesBySenderRef = useRef(new Map());
  const lastPushNotifyBySenderRef = useRef(new Map());
  const dispatchBannerTimeoutRef = useRef(null);

  liveOnRef.current = liveOn;
  micModeRef.current = micMode;
  receiveModeRef.current = receiveMode;
  emergencyModeRef.current = emergencyMode || activeChannel === 'emergency';
  activeChannelRef.current = activeChannel;

  const currentChannelMeta = useMemo(
    () => WALKIE_CHANNELS.find((c) => c.id === activeChannel) || WALKIE_CHANNELS[0],
    [activeChannel]
  );

  // Determines whether an incoming transmission should play audio out loud automatically
  const shouldPlayIncomingAudio = useCallback((isEmergency = false) => {
    if (isEmergency) return true; // Emergency ALWAYS breaks through like Police Radio!
    if (liveOnRef.current) return true; // User explicitly turned LIVE ON
    return receiveModeRef.current === 'all'; // Auto-Listen Police Mode
  }, []);

  const triggerIncomingDispatchBanner = useCallback(
    ({
      senderId,
      senderName,
      senderRole,
      channelId,
      kind = 'talking',
      isEmergency = false,
    }) => {
      if (!senderName || senderId === userId) return;
      const chObj = WALKIE_CHANNELS.find((c) => c.id === channelId) || currentChannelMeta;
      const alertObj = {
        id: `${senderId}_${Date.now()}`,
        sender_id: senderId,
        sender_name: senderName,
        sender_role: senderRole || 'security',
        channel: channelId || activeChannelRef.current,
        channel_label: chObj.shortLabel || chObj.label,
        channel_code: chObj.code,
        kind, // 'session_open' | 'talking' | 'emergency'
        is_emergency: Boolean(isEmergency || channelId === 'emergency'),
        timestamp: new Date().toISOString(),
      };

      setIncomingDispatchAlert(alertObj);
      if (dispatchBannerTimeoutRef.current) {
        clearTimeout(dispatchBannerTimeoutRef.current);
      }
      dispatchBannerTimeoutRef.current = setTimeout(() => {
        setIncomingDispatchAlert((curr) => (curr?.id === alertObj.id ? null : curr));
      }, isEmergency ? 9500 : 5500);

      // Throttle push notifications per sender (at most once every 7 seconds unless emergency)
      const now = Date.now();
      const lastNotifyMs = lastPushNotifyBySenderRef.current.get(senderId) || 0;
      if (isEmergency || now - lastNotifyMs > 7000) {
        lastPushNotifyBySenderRef.current.set(senderId, now);
        const title = isEmergency
          ? `🚨 طوارئ لاسلكي عاجلة — ${senderName}`
          : kind === 'session_open'
          ? `📻 ${senderName} فتح خط اللاسلكي (${chObj.shortLabel})`
          : `🎙️ ${senderName} يتحدث الآن على ${chObj.shortLabel}`;
        const body = isEmergency
          ? `نداء طوارئ يخترق جميع القنوات الآن — الصوت يعمل تلقائياً`
          : kind === 'session_open'
          ? `تم فتح جلسة لاسلكي حية — اضغط للرد الفوري أو استمع مباشرةً`
          : `بث صوتي لاسلكي مباشر على ${chObj.label}`;

        notifyWalkieBackgroundAlert(title, body, {
          isEmergency: Boolean(isEmergency),
          forceShow: Boolean(isEmergency || kind === 'session_open'),
          tag: `zayed-walkie-${senderId}`,
        });
      }
    },
    [userId, currentChannelMeta]
  );

  const commitMergedUnits = useCallback(() => {
    const merged = mergePresenceUnits(cloudUnitsRef.current, serverUnitsRef.current);
    setActiveUnits(merged);
    if (liveOnRef.current) {
      engineRef.current?.syncActiveUnitsFromServer(merged);
    }
  }, []);

  // Enforce allowed channel guard whenever role/permissions change
  useEffect(() => {
    if (!canUseWalkie || allowedChannels.length === 0) return;
    if (!allowedChannels.some((c) => c.id === activeChannel)) {
      setActiveChannelState(defaultChannelId);
    }
  }, [canUseWalkie, allowedChannels, activeChannel, defaultChannelId]);

  // Unlock WebAudio + Start Standby Background Carrier on first trusted user gesture anywhere in the app!
  useEffect(() => {
    if (!canUseWalkie || typeof window === 'undefined') return undefined;
    const handleTrustedGesture = () => {
      unlockWalkieAudio({ fromTrustedGesture: true });
      requestWalkieNotificationPermission();
      // Start background audio carrier in standby so phone can play incoming Police Radio audio even when screen locks!
      if (receiveModeRef.current !== 'muted') {
        const chMeta =
          WALKIE_CHANNELS.find((c) => c.id === activeChannelRef.current) || WALKIE_CHANNELS[0];
        startBackgroundRadioCarrier({
          channelLabel: chMeta.label,
          channelCode: chMeta.code,
          speakerText: 'وضع الاستقبال التلقائي كالشرطة نشط بالخلفية',
          onToggleMicMute: () => {
            const next = micModeRef.current === 'muted' ? 'vad' : 'muted';
            setMicModeState(next);
            engineRef.current?.setMicMode(next);
          },
          onPowerOff: () => {
            setReceiveModeState('muted');
          },
        }).then((ok) => {
          if (ok) setBgKeepAliveActive(true);
        });
      }
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

  // Periodically prune expired standby remote speakers (for when liveOn is false)
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, spk] of standbySpeakersMapRef.current.entries()) {
        if (spk.untilMs < now) {
          standbySpeakersMapRef.current.delete(k);
          changed = true;
        }
      }
      if (changed) {
        const list = Array.from(standbySpeakersMapRef.current.values());
        setStandbyRemoteSpeakers(list);
        if (list.length === 0 && !liveOnRef.current) {
          setLiveLevels(IDLE_BAR_LEVELS);
        }
      }
    }, 350);
    return () => clearInterval(timer);
  }, [canUseWalkie]);

  // Track elapsed speaking seconds + Broadcast speech_start push dispatch when local voice starts!
  useEffect(() => {
    if (!localSpeaking) {
      if (txTimerRef.current) {
        clearInterval(txTimerRef.current);
        txTimerRef.current = null;
      }
      setTxElapsedSec(0);
      return undefined;
    }

    // Broadcast instant push dispatch when local user starts talking!
    const isEmerg = emergencyModeRef.current;
    globalRoomRef.current?.sendDispatch({
      id: `disp_${peerId}_${Date.now()}`,
      kind: isEmerg ? 'emergency' : 'talking',
      is_emergency: isEmerg,
      channel: activeChannelRef.current,
      from_peer_id: peerId,
      sender_id: userId,
      sender_name: authUser?.display_name || 'الأمن',
      sender_role: role,
      ts_ms: Date.now(),
    });

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
  }, [localSpeaking, peerId, userId, authUser?.display_name, role]);

  // Keep Global Supabase Presence speaking state synchronized in real-time
  useEffect(() => {
    if (!canUseWalkie) return;
    globalRoomRef.current?.updatePresence({
      status: localSpeaking ? 'talking' : 'listening',
      live_on: liveOn || receiveMode !== 'muted',
      mic_mode: micMode,
    });
  }, [canUseWalkie, liveOn, localSpeaking, micMode, receiveMode]);

  // Re-acquire Screen Wake Lock & resume audio pipeline when returning to foreground
  useEffect(() => {
    if (!canUseWalkie || typeof document === 'undefined') return undefined;
    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        ensureAudioPipelineResumed();
        if (liveOnRef.current) {
          acquireRadioWakeLock().then((ok) => setWakeLockActive(ok));
        }
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
  }, [canUseWalkie]);

  const dispatchSignalOut = useCallback(
    async (sigPayload) => {
      const isEmerg = Boolean(
        sigPayload.is_emergency ||
          sigPayload.data?.is_emergency ||
          emergencyModeRef.current
      );
      const envelope = {
        id: `${peerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        channel: sigPayload.channel,
        from_peer_id: peerId,
        target_peer_id: sigPayload.target_peer_id || '',
        user_id: userId,
        display_name: authUser?.display_name || 'الأمن',
        role,
        role_label: authUser?.role_label || '',
        avatar_color: authUser?.avatar_color || '#146C2E',
        signal_type: sigPayload.signal_type,
        is_emergency: isEmerg,
        data: sigPayload.data ?? null,
        ts_ms: Date.now(),
      };

      // 1. Instant Global WebSocket Broadcast (< 35ms across any network in the world!)
      const sentViaCloudWs = Boolean(globalRoomRef.current?.sendSignal(envelope));

      // 2. Also sync via NestJS API when not a high-frequency ICE burst or if WS is offline
      if (!sentViaCloudWs || sigPayload.signal_type !== 'ice') {
        sendWalkieSignal({
          ...sigPayload,
          is_emergency: isEmerg,
          cloud_sent: sentViaCloudWs,
        }).then((res) => {
          if (res?.routeMissing) {
            setServerRouteMissing(true);
          } else if (res?.ok) {
            setServerRouteMissing(false);
            if (Array.isArray(res.activeUnits)) {
              serverUnitsRef.current = res.activeUnits;
              commitMergedUnits();
            }
          }
        });
      }
      return { ok: true };
    },
    [
      peerId,
      userId,
      authUser?.display_name,
      authUser?.role_label,
      authUser?.avatar_color,
      role,
      commitMergedUnits,
    ]
  );

  const dispatchLiveFrameOut = useCallback(
    async (framePayload) => {
      const isEmerg = Boolean(
        framePayload.is_emergency ||
          framePayload.channel === 'emergency' ||
          emergencyModeRef.current
      );
      const packet = {
        channel: framePayload.channel,
        from_peer_id: peerId,
        sender_id: userId,
        sender_name: authUser?.display_name || 'الأمن',
        sender_role: role,
        avatar_color: authUser?.avatar_color || '#146C2E',
        sample_rate: framePayload.sample_rate || 8000,
        ulaw_b64: framePayload.ulaw_b64,
        is_emergency: isEmerg,
        ts_ms: Date.now(),
      };

      // 1. Primary Global WebSocket Stream
      const sentViaCloudWs = Boolean(globalRoomRef.current?.sendLiveFrame(packet));

      // 2. Also send to backend ring buffer so polling / reconnecting phones receive live frames too
      const res = await sendWalkieLiveFrame({
        ...framePayload,
        is_emergency: isEmerg,
        cloud_sent: sentViaCloudWs,
      });
      if (res?.routeMissing) {
        setServerRouteMissing(true);
      } else if (res?.ok) {
        setServerRouteMissing(false);
      }
    },
    [peerId, userId, authUser?.display_name, authUser?.avatar_color, role]
  );

  // Automatic Speech Burst Fallback: when user finishes speaking, broadcast WAV clip for any phone that was locked/sleeping
  const handleSpeechBurstComplete = useCallback(
    async ({ wavDataUrl, mimeType, durationSec, isEmergency, channel }) => {
      if (!wavDataUrl) return;
      try {
        const res = await transmitWalkieCall({
          channel: channel || activeChannelRef.current,
          peer_id: peerId,
          kind: 'voice',
          audio_data: wavDataUrl,
          mime_type: mimeType || 'audio/wav',
          duration_sec: durationSec,
          is_emergency: Boolean(isEmergency || emergencyModeRef.current),
        });
        if (res?.call) {
          seenCallIdsRef.current.add(res.call.id);
          setRecentCalls((prev) =>
            [res.call, ...prev.filter((c) => c.id !== res.call.id)].slice(0, 20)
          );
          globalRoomRef.current?.sendTxCall(res.call);
        }
      } catch {
        // Non-fatal fallback
      }
    },
    [peerId]
  );

  const processIncomingDispatch = useCallback(
    (payload) => {
      if (!payload) return;
      const fromPeer = payload.from_peer_id || payload.sender_id;
      if (fromPeer === peerId || payload.sender_id === userId) return;
      if (payload.id) {
        if (seenDispatchIdsRef.current.has(payload.id)) return;
        seenDispatchIdsRef.current.add(payload.id);
      }
      const isEmerg = Boolean(
        payload.is_emergency ||
          payload.channel === 'emergency' ||
          payload.kind === 'emergency'
      );
      if (payload.channel && payload.channel !== activeChannelRef.current && !isEmerg) {
        return;
      }

      if (shouldPlayIncomingAudio(isEmerg)) {
        if (isEmerg) {
          playPoliceEmergencySiren();
        } else if (payload.kind === 'session_open') {
          playIncomingRxChirp({ subtle: false });
        }
      }

      triggerIncomingDispatchBanner({
        senderId: payload.sender_id || fromPeer,
        senderName: payload.sender_name || payload.display_name || 'زميل على القناة',
        senderRole: payload.sender_role || payload.role || 'security',
        channelId: payload.channel || activeChannelRef.current,
        kind: isEmerg ? 'emergency' : payload.kind || 'talking',
        isEmergency: isEmerg,
      });
    },
    [peerId, userId, shouldPlayIncomingAudio, triggerIncomingDispatchBanner]
  );

  const processIncomingSignal = useCallback(
    (envelope) => {
      if (!envelope) return;
      if (envelope.from_peer_id === peerId) return;
      if (envelope.id) {
        if (seenSignalIdsRef.current.has(envelope.id)) return;
        seenSignalIdsRef.current.add(envelope.id);
        if (seenSignalIdsRef.current.size > 400) {
          const first = seenSignalIdsRef.current.values().next().value;
          seenSignalIdsRef.current.delete(first);
        }
      }

      const isEmerg = Boolean(
        envelope.is_emergency ||
          envelope.channel === 'emergency' ||
          envelope.data?.is_emergency ||
          envelope.signal_type === 'emergency_alert'
      );

      // Handle session_open / talking_state / emergency_alert even when liveOn is false (Police Radio Auto-Standby)!
      if (
        envelope.signal_type === 'session_open' ||
        envelope.signal_type === 'emergency_alert' ||
        (envelope.signal_type === 'talking_state' && envelope.data?.talking)
      ) {
        if (envelope.channel === activeChannelRef.current || isEmerg) {
          const kind = isEmerg
            ? 'emergency'
            : envelope.signal_type === 'session_open'
            ? 'session_open'
            : 'talking';

          if (!liveOnRef.current && envelope.signal_type === 'talking_state') {
            const rKey = envelope.from_peer_id || envelope.user_id;
            standbySpeakersMapRef.current.set(rKey, {
              peer_id: rKey,
              user_id: envelope.user_id,
              display_name: envelope.display_name || 'زميل يتحدث',
              role: envelope.role || 'security',
              is_emergency: isEmerg,
              untilMs: Date.now() + 3200,
            });
            setStandbyRemoteSpeakers(Array.from(standbySpeakersMapRef.current.values()));
          }

          if (envelope.signal_type === 'session_open' || envelope.signal_type === 'emergency_alert') {
            if (shouldPlayIncomingAudio(isEmerg)) {
              if (isEmerg) playPoliceEmergencySiren();
              else playIncomingRxChirp({ subtle: false });
            }
          }

          triggerIncomingDispatchBanner({
            senderId: envelope.user_id || envelope.from_peer_id,
            senderName: envelope.display_name || 'زميل على القناة',
            senderRole: envelope.role || 'security',
            channelId: envelope.channel || activeChannelRef.current,
            kind,
            isEmergency: isEmerg,
          });
        }
      } else if (
        !liveOnRef.current &&
        envelope.signal_type === 'talking_state' &&
        !envelope.data?.talking
      ) {
        const rKey = envelope.from_peer_id || envelope.user_id;
        standbySpeakersMapRef.current.delete(rKey);
        setStandbyRemoteSpeakers(Array.from(standbySpeakersMapRef.current.values()));
      }

      if (liveOnRef.current) {
        engineRef.current?.handleSignal(envelope);
      }
    },
    [peerId, shouldPlayIncomingAudio, triggerIncomingDispatchBanner]
  );

  const processIncomingLiveFrame = useCallback(
    (packet) => {
      if (!packet || !packet.ulaw_b64) return;
      const remotePeerId = packet.from_peer_id || packet.sender_id;
      if (!remotePeerId || remotePeerId === peerId || packet.sender_id === userId) return;

      const isEmerg = Boolean(
        packet.is_emergency || packet.channel === 'emergency'
      );
      if (packet.channel !== activeChannelRef.current && !isEmerg) return;

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

      // Record that we received & played live frames from this sender so we don't double-play the fallback WAV clip
      const senderKey = packet.sender_id || remotePeerId;
      const prevRec = lastLiveFramesBySenderRef.current.get(senderKey) || { count: 0, lastMs: 0 };
      const now = Date.now();
      const nextCount = now - prevRec.lastMs < 5000 ? prevRec.count + 1 : 1;

      triggerIncomingDispatchBanner({
        senderId: senderKey,
        senderName: packet.sender_name || 'زميل يتحدث',
        senderRole: packet.sender_role || 'security',
        channelId: packet.channel || activeChannelRef.current,
        kind: isEmerg ? 'emergency' : 'talking',
        isEmergency: isEmerg,
      });

      if (!shouldPlayIncomingAudio(isEmerg)) {
        return;
      }

      if (liveOnRef.current && engineRef.current) {
        lastLiveFramesBySenderRef.current.set(senderKey, { count: nextCount, lastMs: now });
        engineRef.current.handleLiveFrame(packet);
        return;
      }

      // Police Radio Standby Auto-Receive Mode (when liveOn is OFF — user hears automatically without pressing ON!)
      const playedOk = playIncomingLiveMuLawFrame(remotePeerId, packet.ulaw_b64, {
        sampleRate: packet.sample_rate || 8000,
        isEmergency: isEmerg,
        onLevel: (bars) => setLiveLevels(bars),
      });
      if (playedOk) {
        lastLiveFramesBySenderRef.current.set(senderKey, { count: nextCount, lastMs: now });
      }

      standbySpeakersMapRef.current.set(remotePeerId, {
        peer_id: remotePeerId,
        user_id: senderKey,
        display_name: packet.sender_name || 'زميل يتحدث',
        role: packet.sender_role || 'security',
        is_emergency: isEmerg,
        untilMs: now + 1200,
      });
      setStandbyRemoteSpeakers(Array.from(standbySpeakersMapRef.current.values()));
    },
    [peerId, userId, shouldPlayIncomingAudio, triggerIncomingDispatchBanner]
  );

  const handleIncomingTxCall = useCallback(
    (payload) => {
      const call = payload?.call;
      if (!call?.id) return;
      const already = seenCallIdsRef.current.has(call.id);
      seenCallIdsRef.current.add(call.id);
      setRecentCalls((prev) => {
        if (prev.some((c) => c.id === call.id)) return prev;
        return [call, ...prev].slice(0, 20);
      });

      if (already || call.sender_id === userId) return;

      const isEmerg = Boolean(call.is_emergency || call.channel === 'emergency');
      if (call.channel !== activeChannelRef.current && !isEmerg) return;

      triggerIncomingDispatchBanner({
        senderId: call.sender_id,
        senderName: call.sender_name || 'زميل على القناة',
        senderRole: call.sender_role || 'security',
        channelId: call.channel || activeChannelRef.current,
        kind: isEmerg || call.kind === 'ping' ? 'emergency' : 'talking',
        isEmergency: isEmerg || call.kind === 'ping',
      });

      if (call.kind === 'ping') {
        playUrgentPagerTone();
        return;
      }

      if (call.audio_data && shouldPlayIncomingAudio(isEmerg)) {
        // Check if we ALREADY played the live μ-law stream for this exact speech burst in the last 7.5 seconds
        const liveRec = lastLiveFramesBySenderRef.current.get(call.sender_id);
        const alreadyHeardLive =
          liveRec && liveRec.count >= 2 && Date.now() - liveRec.lastMs < 7500;
        if (!alreadyHeardLive) {
          setActivePlaybackCall(call);
          playWalkieAudioClip(call.audio_data, {
            onLevel: setLiveLevels,
            withRadioEffects: true,
            isEmergency: isEmerg,
          }).finally(() => {
            setActivePlaybackCall((curr) => (curr?.id === call.id ? null : curr));
          });
        }
      }
    },
    [userId, shouldPlayIncomingAudio, triggerIncomingDispatchBanner]
  );

  const runChannelPollHeartbeat = useCallback(async () => {
    if (!canUseWalkie) return;
    const ch = activeChannelRef.current;
    const isLive = liveOnRef.current;
    const res = await pollWalkieChannel({
      channel: ch,
      since: lastSinceRef.current,
      listening: isLive || receiveModeRef.current !== 'muted',
      peerId,
      liveOn: isLive,
      lastFrameSeq: lastFrameSeqRef.current,
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
      serverUnitsRef.current = res.activeUnits;
      commitMergedUnits();
    }
    if (res.channelActivitySummary && typeof res.channelActivitySummary === 'object') {
      setChannelActivitySummary(res.channelActivitySummary);
    }

    if (Array.isArray(res.signals)) {
      for (const sig of res.signals) {
        processIncomingSignal(sig);
      }
    }

    if (Array.isArray(res.liveFrames)) {
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
        if (!already && hadInitialBaseline && c.sender_id !== userId) {
          const isEmerg = Boolean(c.is_emergency || c.channel === 'emergency');
          if (c.kind === 'ping') {
            playUrgentPagerTone();
            triggerIncomingDispatchBanner({
              senderId: c.sender_id,
              senderName: c.sender_name,
              senderRole: c.sender_role,
              channelId: c.channel,
              kind: 'emergency',
              isEmergency: true,
            });
          } else if (c.audio_data && shouldPlayIncomingAudio(isEmerg)) {
            const liveRec = lastLiveFramesBySenderRef.current.get(c.sender_id);
            const alreadyHeardLive =
              liveRec && liveRec.count >= 2 && Date.now() - liveRec.lastMs < 7500;
            if (!alreadyHeardLive) {
              setActivePlaybackCall(c);
              playWalkieAudioClip(c.audio_data, {
                onLevel: setLiveLevels,
                withRadioEffects: true,
                isEmergency: isEmerg,
              }).finally(() => {
                setActivePlaybackCall((curr) => (curr?.id === c.id ? null : curr));
              });
            }
          }
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
  }, [
    canUseWalkie,
    peerId,
    userId,
    commitMergedUnits,
    processIncomingSignal,
    processIncomingLiveFrame,
    shouldPlayIncomingAudio,
    triggerIncomingDispatchBanner,
  ]);

  const setReceiveMode = useCallback((nextMode) => {
    if (!['all', 'emergency_only', 'muted'].includes(nextMode)) return;
    unlockWalkieAudio({ fromTrustedGesture: true });
    setReceiveModeState(nextMode);
    receiveModeRef.current = nextMode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RADIO_RECEIVE_MODE_KEY, nextMode);
    }
    if (nextMode !== 'muted') {
      const chMeta =
        WALKIE_CHANNELS.find((c) => c.id === activeChannelRef.current) || WALKIE_CHANNELS[0];
      startBackgroundRadioCarrier({
        channelLabel: chMeta.label,
        channelCode: chMeta.code,
        speakerText:
          nextMode === 'all'
            ? 'الاستقبال التلقائي للكل (وضع الشرطة) نشط بالخلفية'
            : 'استقبال نداءات الطوارئ فقط نشط بالخلفية',
      }).then((ok) => setBgKeepAliveActive(ok));
    } else if (!liveOnRef.current) {
      stopBackgroundRadioCarrier();
      setBgKeepAliveActive(false);
    }
  }, []);

  const setEmergencyMode = useCallback((val) => {
    unlockWalkieAudio({ fromTrustedGesture: true });
    const next = typeof val === 'function' ? val(emergencyModeRef.current) : Boolean(val);
    setEmergencyModeState(next);
    emergencyModeRef.current = next || activeChannelRef.current === 'emergency';
    engineRef.current?.setEmergencyMode(emergencyModeRef.current);
  }, []);

  const setMicMode = useCallback(
    (nextMode) => {
      if (!['vad', 'open', 'muted'].includes(nextMode)) return;
      unlockWalkieAudio({ fromTrustedGesture: true });
      setMicModeState(nextMode);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(RADIO_MIC_MODE_KEY, nextMode);
      }
      engineRef.current?.setMicMode(nextMode);
      globalRoomRef.current?.updatePresence({
        mic_mode: nextMode,
        live_on: liveOnRef.current,
      });
      if (liveOnRef.current) {
        updateWalkiePresence({
          channel: activeChannelRef.current,
          peer_id: peerId,
          status: 'listening',
          live_on: true,
          mic_mode: nextMode,
        });
      }
    },
    [peerId]
  );

  const turnLiveOff = useCallback(() => {
    setLiveOn(false);
    liveOnRef.current = false;
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

    // Keep background radio carrier running if Auto-Receive Police Mode is active!
    if (receiveModeRef.current === 'muted') {
      stopBackgroundRadioCarrier();
      setBgKeepAliveActive(false);
    }
    releaseRadioWakeLock().then(() => setWakeLockActive(false));

    globalRoomRef.current?.updatePresence({
      status: 'listening',
      live_on: receiveModeRef.current !== 'muted',
    });

    updateWalkiePresence({
      channel: activeChannelRef.current,
      peer_id: peerId,
      status: receiveModeRef.current !== 'muted' ? 'listening' : 'offline',
      live_on: receiveModeRef.current !== 'muted',
    });
  }, [peerId]);

  const startEngineForChannel = useCallback(
    async (targetChannelId, { forceEmergency = false } = {}) => {
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }

      const chMeta =
        WALKIE_CHANNELS.find((c) => c.id === targetChannelId) || WALKIE_CHANNELS[0];
      const isEmerg = Boolean(
        forceEmergency || emergencyModeRef.current || targetChannelId === 'emergency'
      );

      setConnectingLive(true);
      setMicWarning('');

      requestWalkieNotificationPermission();

      const carrierOk = await startBackgroundRadioCarrier({
        channelLabel: chMeta.label,
        channelCode: chMeta.code,
        speakerText: 'الخط الحي مفتوح بالخلفية — جاهز للتحدث والاستماع الفوري',
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

      const engine = createLiveRadioRoomEngine({
        peerId,
        channel: targetChannelId,
        initialMicMode: micModeRef.current,
        initialEmergencyMode: isEmerg,
        sendSignal: dispatchSignalOut,
        sendLiveFrame: dispatchLiveFrameOut,
        onSpeechBurstComplete: handleSpeechBurstComplete,
        onLocalSpeakingChange: setLocalSpeaking,
        onRemoteSpeakersChange: setEngineRemoteSpeakers,
        onMeshPeersChange: setMeshConnectedCount,
        onLevels: setLiveLevels,
        onHeartbeatTick: () => {
          if (!globalRoomRef.current?.isConnected() || Math.random() < 0.45) {
            runChannelPollHeartbeat();
          }
        },
        onMicWarning: (msg) => setMicWarning(msg),
      });

      engineRef.current = engine;
      setLiveOn(true);
      liveOnRef.current = true;

      await engine.start();
      setConnectingLive(false);

      // Broadcast session_open push alert to ALL colleagues on the channel (or all channels if emergency)!
      globalRoomRef.current?.sendDispatch({
        id: `open_${peerId}_${Date.now()}`,
        kind: isEmerg ? 'emergency' : 'session_open',
        is_emergency: isEmerg,
        channel: targetChannelId,
        from_peer_id: peerId,
        sender_id: userId,
        sender_name: authUser?.display_name || 'الأمن',
        sender_role: role,
        ts_ms: Date.now(),
      });

      dispatchSignalOut({
        channel: targetChannelId,
        peer_id: peerId,
        signal_type: isEmerg ? 'emergency_alert' : 'session_open',
        is_emergency: isEmerg,
        data: {
          mic_mode: micModeRef.current,
          is_emergency: isEmerg,
        },
      });

      await globalRoomRef.current?.updatePresence({
        channel: targetChannelId,
        status: 'listening',
        live_on: true,
        mic_mode: micModeRef.current,
      });

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
        serverUnitsRef.current = presRes.activeUnits;
      }
      commitMergedUnits();
      runChannelPollHeartbeat();
    },
    [
      peerId,
      userId,
      authUser?.display_name,
      role,
      dispatchSignalOut,
      dispatchLiveFrameOut,
      handleSpeechBurstComplete,
      runChannelPollHeartbeat,
      commitMergedUnits,
      setMicMode,
      turnLiveOff,
    ]
  );

  const turnLiveOn = useCallback(
    async ({ asEmergency = false } = {}) => {
      if (!canUseWalkie || connectingLive) return;
      unlockWalkieAudio({ fromTrustedGesture: true });
      if (asEmergency) {
        setEmergencyModeState(true);
        emergencyModeRef.current = true;
      }
      await startEngineForChannel(activeChannelRef.current, { forceEmergency: asEmergency });
    },
    [canUseWalkie, connectingLive, startEngineForChannel]
  );

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
      cloudUnitsRef.current = [];
      serverUnitsRef.current = [];
      setActiveChannelState(channelId);
      activeChannelRef.current = channelId;
      const isEmergCh = channelId === 'emergency';
      setEmergencyModeState(isEmergCh);
      emergencyModeRef.current = isEmergCh;
      if (typeof localStorage !== 'undefined' && !isEmergCh) {
        localStorage.setItem(RADIO_CHANNEL_KEY, channelId);
      }
      if (liveOnRef.current) {
        await startEngineForChannel(channelId, { forceEmergency: isEmergCh });
      }
    },
    [allowedChannels, startEngineForChannel]
  );

  const startTransmit = useCallback(
    async ({ asEmergency = false } = {}) => {
      if (!canUseWalkie) return;
      unlockWalkieAudio({ fromTrustedGesture: true });
      if (asEmergency) {
        setEmergencyModeState(true);
        emergencyModeRef.current = true;
        engineRef.current?.setEmergencyMode(true);
      }
      if (!liveOnRef.current) {
        await turnLiveOn({ asEmergency });
      }
      setPttOverrideState(true);
      engineRef.current?.setPttPressed(true);
    },
    [canUseWalkie, turnLiveOn]
  );

  const stopTransmit = useCallback(() => {
    setPttOverrideState(false);
    engineRef.current?.setPttPressed(false);
  }, []);

  const cancelTransmit = stopTransmit;

  // Subscribe to SSE walkie events forwarded from App.jsx (local LAN bonus)
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    const listener = (type, payload) => {
      if (type === 'walkie_signal' && payload) {
        processIncomingSignal(payload);
      } else if (type === 'walkie_live_frame' && payload) {
        processIncomingLiveFrame(payload);
      } else if (type === 'walkie_dispatch' && payload) {
        processIncomingDispatch(payload);
      } else if (type === 'walkie_presence' && Array.isArray(payload?.activeUnits)) {
        if (!payload.channel || payload.channel === activeChannelRef.current) {
          serverUnitsRef.current = payload.activeUnits;
          commitMergedUnits();
        }
      } else if (type === 'walkie_tx' && payload?.call) {
        handleIncomingTxCall(payload);
      }
    };
    sseWalkieListeners.add(listener);
    return () => sseWalkieListeners.delete(listener);
  }, [
    canUseWalkie,
    commitMergedUnits,
    processIncomingSignal,
    processIncomingLiveFrame,
    processIncomingDispatch,
    handleIncomingTxCall,
  ]);

  // Global Multi-Network Supabase Realtime Room (Always Connected for Police Radio Auto-Receive!)
  useEffect(() => {
    if (!canUseWalkie || !userId) return undefined;

    const room = joinGlobalWalkieRoom({
      channel: activeChannel,
      peerId,
      user: authUser,
      initialStatus: 'listening',
      initialLiveOn: liveOnRef.current || receiveModeRef.current !== 'muted',
      initialMicMode: micModeRef.current,
      onConnectionChange: (connected) => {
        setGlobalCloudConnected(connected);
      },
      onPresenceSync: (units) => {
        cloudUnitsRef.current = units;
        commitMergedUnits();
      },
      onSignal: (envelope) => {
        processIncomingSignal(envelope);
      },
      onLiveFrame: (packet) => {
        processIncomingLiveFrame(packet);
      },
      onTxCall: (payload) => {
        handleIncomingTxCall(payload);
      },
      onDispatch: (payload) => {
        processIncomingDispatch(payload);
      },
    });

    globalRoomRef.current = room;

    return () => {
      globalRoomRef.current = null;
      setGlobalCloudConnected(false);
      room?.leave();
    };
  }, [
    canUseWalkie,
    userId,
    activeChannel,
    peerId,
    authUser?.display_name,
    authUser?.role,
    authUser?.avatar_color,
    commitMergedUnits,
    processIncomingSignal,
    processIncomingLiveFrame,
    processIncomingDispatch,
    handleIncomingTxCall,
  ]);

  // Continuous Standby Poll (Every 3.5s in standby so phones always catch live frames & alerts even if WS blips!)
  useEffect(() => {
    if (!canUseWalkie) return undefined;
    runChannelPollHeartbeat();

    if (liveOn) return undefined;
    const standbyIntervalMs = serverRouteMissing ? 12000 : 3500;
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
      globalRoomRef.current?.sendDispatch({
        id: `emerg_${peerId}_${Date.now()}`,
        kind: 'emergency',
        is_emergency: true,
        channel: activeChannelRef.current,
        from_peer_id: peerId,
        sender_id: userId,
        sender_name: authUser?.display_name || 'الأمن',
        sender_role: role,
        ts_ms: Date.now(),
      });

      const res = await transmitWalkieCall({
        channel: activeChannelRef.current,
        peer_id: peerId,
        kind: 'ping',
        is_emergency: true,
      });
      if (res?.call) {
        seenCallIdsRef.current.add(res.call.id);
        setRecentCalls((prev) =>
          [res.call, ...prev.filter((c) => c.id !== res.call.id)].slice(0, 20)
        );
        globalRoomRef.current?.sendTxCall(res.call);
      }
      onToast?.('🚨 تم إرسال نداء وصافرة طوارئ لاسلكية عاجلة لجميع الأجهزة المتصلة فوراً');
    } catch (err) {
      onToast?.(err.message || 'تعذر إرسال جرس الانتباه', 'error');
    }
  }, [canUseWalkie, peerId, userId, authUser?.display_name, role, onToast]);

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
        isEmergency: Boolean(call.is_emergency || call.channel === 'emergency'),
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
      if (dispatchBannerTimeoutRef.current) clearTimeout(dispatchBannerTimeoutRef.current);
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
      globalRoomRef.current?.leave();
      stopBackgroundRadioCarrier();
      releaseRadioWakeLock();
    };
  }, []);

  const liveSpeakingUnits = useMemo(() => {
    const map = new Map();
    for (const s of engineRemoteSpeakers) {
      if (s.peer_id && s.peer_id !== peerId) {
        map.set(s.peer_id, s);
      }
    }
    for (const s of standbyRemoteSpeakers) {
      if (s.peer_id && s.peer_id !== peerId && !map.has(s.peer_id)) {
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
  }, [engineRemoteSpeakers, standbyRemoteSpeakers, activeUnits, peerId]);

  useEffect(() => {
    if (!liveOn && receiveMode === 'muted') return;
    const names = liveSpeakingUnits.map((u) => u.display_name).filter(Boolean);
    const speakerText = localSpeaking
      ? 'أنت تتحدث الآن على الخط العالمي الحي...'
      : names.length > 0
      ? `يتحدث الآن: ${names.join(' + ')}`
      : liveOn
      ? 'الخط العالمي مفتوح بالخلفية — تكلم في أي وقت'
      : 'وضع الاستقبال التلقائي كالشرطة نشط بالخلفية';

    updateBackgroundRadioMediaSession({
      channelLabel: currentChannelMeta.label,
      channelCode: currentChannelMeta.code,
      speakerText,
      onToggleMicMute: () => {
        setMicMode(micModeRef.current === 'muted' ? 'vad' : 'muted');
      },
      onPowerOff: turnLiveOff,
    });
  }, [
    liveOn,
    receiveMode,
    localSpeaking,
    liveSpeakingUnits,
    micMode,
    currentChannelMeta,
    setMicMode,
    turnLiveOff,
  ]);

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
    liveOn,
    connectingLive,
    globalCloudConnected,
    toggleLivePower,
    turnLiveOn,
    turnLiveOff,
    radioEnabled: liveOn,
    setRadioEnabled: (val) => {
      const next = typeof val === 'function' ? val(liveOn) : Boolean(val);
      if (next) turnLiveOn();
      else turnLiveOff();
    },
    receiveMode,
    setReceiveMode,
    emergencyMode: emergencyMode || activeChannel === 'emergency',
    setEmergencyMode,
    micMode,
    setMicMode,
    pttOverride,
    localSpeaking,
    pttState,
    txElapsedSec,
    liveLevels,
    activeUnits,
    channelActivitySummary,
    liveSpeakingUnits,
    remoteTalkingUnit: liveSpeakingUnits[0] || null,
    incomingDispatchAlert,
    dismissDispatchAlert: () => setIncomingDispatchAlert(null),
    meshConnectedCount,
    bgKeepAliveActive,
    wakeLockActive,
    micWarning,
    serverRouteMissing,
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
