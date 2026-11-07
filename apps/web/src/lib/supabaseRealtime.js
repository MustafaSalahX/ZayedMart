/**
 * مركز المزامنة اللحظية العالمية لزايد مارت عبر Supabase Realtime (WebSockets)
 * - يربط جميع الهواتف والكمبيوترات من أي شبكة في العالم (4G / 5G / Wi-Fi منزلي / Wi-Fi الفرع)
 * - مزامنة فورية للبيانات (إضافة/تعديل موظف، حضور، نواقص، عربيات) بدون أي تعارض (< 100ms)
 * - غرفة لاسلكي عالمية حية (Presence + WebRTC Signaling + 8kHz G.711 μ-law Audio Relay)
 */

import { createClient } from '@supabase/supabase-js';
import { ZAYED_SUPABASE_ANON_KEY, ZAYED_SUPABASE_URL } from '@zayed-mart/shared';

let activeSupabaseUrl = (import.meta.env?.VITE_SUPABASE_URL || ZAYED_SUPABASE_URL || '').trim();
let activeSupabaseAnonKey = (
  import.meta.env?.VITE_SUPABASE_ANON_KEY ||
  ZAYED_SUPABASE_ANON_KEY ||
  ''
).trim();
let activeSyncTopic = 'zayed_ops_sync_v1';

let sharedClient = null;
let sharedClientKeySignature = '';

let storeSyncChannel = null;
const storeSyncListeners = new Set();

export function getGlobalSupabaseClient() {
  if (!activeSupabaseUrl || !activeSupabaseAnonKey) return null;
  const sig = `${activeSupabaseUrl}::${activeSupabaseAnonKey}`;
  if (sharedClient && sharedClientKeySignature === sig) {
    return sharedClient;
  }
  sharedClientKeySignature = sig;
  sharedClient = createClient(activeSupabaseUrl, activeSupabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 40,
      },
    },
  });
  return sharedClient;
}

export function configureCloudRealtimeFromBootstrap(cloudRealtime) {
  if (!cloudRealtime?.enabled || !cloudRealtime?.url || !cloudRealtime?.anonKey) return;
  const nextUrl = String(cloudRealtime.url).trim();
  const nextKey = String(cloudRealtime.anonKey).trim();
  if (cloudRealtime.syncTopic) {
    activeSyncTopic = String(cloudRealtime.syncTopic).trim();
  }
  if (nextUrl !== activeSupabaseUrl || nextKey !== activeSupabaseAnonKey) {
    activeSupabaseUrl = nextUrl;
    activeSupabaseAnonKey = nextKey;
    if (storeSyncChannel && sharedClient) {
      try {
        sharedClient.removeChannel(storeSyncChannel);
      } catch {
        // ignore
      }
      storeSyncChannel = null;
    }
    sharedClient = null;
    ensureStoreSyncChannel();
  }
}

function ensureStoreSyncChannel() {
  if (storeSyncChannel || storeSyncListeners.size === 0) return storeSyncChannel;
  const supabase = getGlobalSupabaseClient();
  if (!supabase) return null;

  const ch = supabase.channel(activeSyncTopic, {
    config: {
      broadcast: { self: false, ack: false },
    },
  });

  ch.on('broadcast', { event: 'db_change' }, ({ payload }) => {
    for (const listener of storeSyncListeners) {
      try {
        listener(payload || { reason: 'cloud_change' });
      } catch {
        // ignore
      }
    }
  });

  ch.subscribe();
  storeSyncChannel = ch;
  return ch;
}

export function subscribeGlobalStoreSync(onStoreChanged) {
  if (typeof onStoreChanged !== 'function') return () => {};
  storeSyncListeners.add(onStoreChanged);
  ensureStoreSyncChannel();
  return () => {
    storeSyncListeners.delete(onStoreChanged);
    if (storeSyncListeners.size === 0 && storeSyncChannel && sharedClient) {
      try {
        sharedClient.removeChannel(storeSyncChannel);
      } catch {
        // ignore
      }
      storeSyncChannel = null;
    }
  };
}

export function broadcastGlobalStoreChange(reason = 'mutation') {
  try {
    const ch = ensureStoreSyncChannel();
    if (!ch) return;
    ch.send({
      type: 'broadcast',
      event: 'db_change',
      payload: { reason, at: new Date().toISOString() },
    });
  } catch {
    // Non-blocking
  }
}

function flattenPresenceState(presenceState, channelId) {
  const unitsByPeer = new Map();
  if (!presenceState || typeof presenceState !== 'object') return [];
  for (const [key, presences] of Object.entries(presenceState)) {
    if (!Array.isArray(presences) || presences.length === 0) continue;
    const latest = presences[presences.length - 1];
    const pId = latest.peer_id || key;
    if (!pId) continue;
    unitsByPeer.set(pId, {
      peer_id: pId,
      user_id: latest.user_id || pId,
      display_name: latest.display_name || 'زميل متصل',
      role: latest.role || 'security',
      role_label: latest.role_label || '',
      avatar_color: latest.avatar_color || '#146C2E',
      channel: latest.channel || channelId,
      status: latest.status || 'listening',
      live_on: Boolean(latest.live_on),
      mic_mode: latest.mic_mode || 'vad',
      updated_at: latest.updated_at || new Date().toISOString(),
      transport: 'supabase_global',
    });
  }
  return Array.from(unitsByPeer.values());
}

/**
 * انضمام حي فوري لغرفة اللاسلكي العالمية عبر Supabase Realtime
 * يعمل عبر أي شبكة إنترنت في العالم (بيانات هاتف 4G/5G أو Wi-Fi مختلف)
 */
export function joinGlobalWalkieRoom({
  channel = 'security',
  peerId,
  user,
  initialStatus = 'listening',
  initialLiveOn = false,
  initialMicMode = 'vad',
  onPresenceSync,
  onSignal,
  onLiveFrame,
  onTxCall,
  onDispatch,
  onConnectionChange,
}) {
  const supabase = getGlobalSupabaseClient();
  if (!supabase || !peerId || !user?.id) return null;

  const topicName = `zayed_walkie_ch_${channel}`;
  let isSubscribed = false;
  let isEmergencySubscribed = false;
  let currentTrackedState = {
    peer_id: peerId,
    user_id: user.id,
    display_name: user.display_name || 'الأمن',
    role: user.role || 'security',
    role_label: user.role_label || '',
    avatar_color: user.avatar_color || '#146C2E',
    channel,
    status: initialStatus,
    live_on: Boolean(initialLiveOn),
    mic_mode: initialMicMode,
    updated_at: new Date().toISOString(),
  };

  const roomChannel = supabase.channel(topicName, {
    config: {
      presence: { key: peerId },
      broadcast: { self: false, ack: false },
    },
  });

  const emitPresenceList = () => {
    try {
      const state = roomChannel.presenceState();
      const units = flattenPresenceState(state, channel);
      onPresenceSync?.(units);
    } catch {
      // ignore
    }
  };

  roomChannel
    .on('presence', { event: 'sync' }, emitPresenceList)
    .on('presence', { event: 'join' }, emitPresenceList)
    .on('presence', { event: 'leave' }, emitPresenceList)
    .on('broadcast', { event: 'walkie_signal' }, ({ payload }) => {
      if (payload) onSignal?.(payload);
    })
    .on('broadcast', { event: 'walkie_live_frame' }, ({ payload }) => {
      if (payload) onLiveFrame?.(payload);
    })
    .on('broadcast', { event: 'walkie_tx' }, ({ payload }) => {
      if (payload) onTxCall?.(payload);
    })
    .on('broadcast', { event: 'walkie_dispatch' }, ({ payload }) => {
      if (payload) onDispatch?.(payload);
    })
    .subscribe(async (status) => {
      const nowConnected = status === 'SUBSCRIBED';
      isSubscribed = nowConnected;
      onConnectionChange?.(nowConnected);
      if (nowConnected) {
        try {
          await roomChannel.track({
            ...currentTrackedState,
            updated_at: new Date().toISOString(),
          });
        } catch {
          // ignore
        }
      }
    });

  // Also listen & broadcast to Global Emergency Channel (CH-09) if user is tuned to CH-01 / CH-02 / CH-03
  let emergencyChannel = null;
  if (channel !== 'emergency') {
    emergencyChannel = supabase.channel('zayed_walkie_ch_emergency', {
      config: {
        broadcast: { self: false, ack: false },
      },
    });
    emergencyChannel
      .on('broadcast', { event: 'walkie_signal' }, ({ payload }) => {
        if (payload) onSignal?.(payload);
      })
      .on('broadcast', { event: 'walkie_live_frame' }, ({ payload }) => {
        if (payload) onLiveFrame?.(payload);
      })
      .on('broadcast', { event: 'walkie_tx' }, ({ payload }) => {
        if (payload) onTxCall?.(payload);
      })
      .on('broadcast', { event: 'walkie_dispatch' }, ({ payload }) => {
        if (payload) onDispatch?.(payload);
      })
      .subscribe((status) => {
        isEmergencySubscribed = status === 'SUBSCRIBED';
      });
  }

  return {
    isConnected: () => isSubscribed,

    async updatePresence(patch = {}) {
      currentTrackedState = {
        ...currentTrackedState,
        ...patch,
        channel,
        peer_id: peerId,
        updated_at: new Date().toISOString(),
      };
      if (!isSubscribed) return false;
      try {
        await roomChannel.track(currentTrackedState);
        return true;
      } catch {
        return false;
      }
    },

    sendSignal(envelope) {
      if (!isSubscribed) return false;
      try {
        roomChannel.send({
          type: 'broadcast',
          event: 'walkie_signal',
          payload: envelope,
        });
        if (
          (envelope?.is_emergency || envelope?.data?.is_emergency) &&
          emergencyChannel &&
          isEmergencySubscribed
        ) {
          emergencyChannel.send({
            type: 'broadcast',
            event: 'walkie_signal',
            payload: envelope,
          });
        }
        return true;
      } catch {
        return false;
      }
    },

    sendLiveFrame(framePacket) {
      if (!isSubscribed) return false;
      try {
        roomChannel.send({
          type: 'broadcast',
          event: 'walkie_live_frame',
          payload: framePacket,
        });
        if (framePacket?.is_emergency && emergencyChannel && isEmergencySubscribed) {
          emergencyChannel.send({
            type: 'broadcast',
            event: 'walkie_live_frame',
            payload: framePacket,
          });
        }
        return true;
      } catch {
        return false;
      }
    },

    sendTxCall(callObj) {
      if (!isSubscribed) return false;
      try {
        roomChannel.send({
          type: 'broadcast',
          event: 'walkie_tx',
          payload: { call: callObj },
        });
        if (callObj?.is_emergency && emergencyChannel && isEmergencySubscribed) {
          emergencyChannel.send({
            type: 'broadcast',
            event: 'walkie_tx',
            payload: { call: callObj },
          });
        }
        return true;
      } catch {
        return false;
      }
    },

    sendDispatch(dispatchPayload) {
      if (!isSubscribed) return false;
      try {
        roomChannel.send({
          type: 'broadcast',
          event: 'walkie_dispatch',
          payload: dispatchPayload,
        });
        if (dispatchPayload?.is_emergency && emergencyChannel && isEmergencySubscribed) {
          emergencyChannel.send({
            type: 'broadcast',
            event: 'walkie_dispatch',
            payload: dispatchPayload,
          });
        }
        return true;
      } catch {
        return false;
      }
    },

    leave() {
      isSubscribed = false;
      isEmergencySubscribed = false;
      try {
        roomChannel.untrack();
      } catch {
        // ignore
      }
      try {
        supabase.removeChannel(roomChannel);
      } catch {
        // ignore
      }
      if (emergencyChannel) {
        try {
          supabase.removeChannel(emergencyChannel);
        } catch {
          // ignore
        }
      }
    },
  };
}
