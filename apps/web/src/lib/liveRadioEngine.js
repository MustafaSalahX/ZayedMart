/**
 * محرك الغرفة الصوتية الحية المتزامنة للاسلكي زايد مارت (Live Multi-Peer Intercom Engine)
 * - ربط صوتي مباشر متزامن (WebRTC RTCPeerConnection Mesh - Full Duplex < 50ms)
 * - بث احتياطي فوري ذكي (250ms 8kHz G.711 μ-law Frames) يعمل تلقائياً قبل اكتمال ICE أو خلف 4G NAT الصارم
 * - معالجة الصوت وبوابة التحدث الذكية (Smart VAD) داخل خيط الصوت المستقل (AudioWorklet) للعمل في الخلفية وقفل الشاشة
 * - مؤقت Web Worker خلفي غير خاضع لتجميد المتصفح للحفاظ على الاتصال حياً بالخلفية
 */

import {
  IDLE_BAR_LEVELS,
  computeBarsFromRms,
  encodeFloat32ToMuLawBase64,
  getSharedAudioContext,
  playIncomingLiveMuLawFrame,
  playPttEndSquelch,
  playPttStartChirp,
  unlockWalkieAudio,
} from './walkieAudio.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

const VAD_TRIGGER_RMS = 0.015;
const VAD_HANG_MS = 580;

const WORKLET_PROCESSOR_CODE = `
class ZayedWalkieLiveProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 8000;
    this._frameBuf = new Float32Array(2000); // 250ms @ 8000Hz
    this._frameIdx = 0;
    this._meterSamples = 0;
    this._meterSumSq = 0;
    this._resampleAcc = 0;
    this._resampleCount = 0;
    this._step = sampleRate / this._targetRate;
    this._inPos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }
    const ch = input[0];
    const ratio = sampleRate / this._targetRate;

    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this._resampleAcc += s;
      this._resampleCount += 1;
      this._inPos += 1;

      if (this._inPos >= ratio) {
        this._inPos -= ratio;
        const downSample = this._resampleCount > 0 ? this._resampleAcc / this._resampleCount : s;
        this._resampleAcc = 0;
        this._resampleCount = 0;

        this._meterSumSq += downSample * downSample;
        this._meterSamples += 1;

        // Fast ~64ms meter tick (512 samples @ 8kHz) for instant <65ms VAD gate opening
        if (this._meterSamples >= 512) {
          const rms = Math.sqrt(this._meterSumSq / this._meterSamples);
          this.port.postMessage({ type: 'meter', rms });
          this._meterSumSq = 0;
          this._meterSamples = 0;
        }

        this._frameBuf[this._frameIdx++] = downSample;
        if (this._frameIdx >= 2000) {
          let sum = 0;
          for (let k = 0; k < 2000; k++) {
            sum += this._frameBuf[k] * this._frameBuf[k];
          }
          const frameRms = Math.sqrt(sum / 2000);
          const copy = new Float32Array(this._frameBuf);
          this.port.postMessage({ type: 'frame', rms: frameRms, samples8k: copy }, [copy.buffer]);
          this._frameIdx = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('zayed-walkie-live-proc', ZayedWalkieLiveProcessor);
`;

let workletLoadedForCtx = new WeakSet();

function createBackgroundHeartbeatWorker(intervalMs = 2200, onTick) {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const code = `
        let timer = setInterval(() => postMessage('tick'), ${Number(intervalMs) || 2200});
        onmessage = (e) => {
          if (e.data === 'stop') {
            clearInterval(timer);
            close();
          }
        };
      `;
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      worker.onmessage = () => onTick?.();
      return {
        stop() {
          try {
            worker.postMessage('stop');
            worker.terminate();
          } catch {
            // ignore
          }
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        },
      };
    } catch {
      // Fallback to standard setInterval below
    }
  }

  const id = setInterval(() => onTick?.(), intervalMs);
  return {
    stop() {
      clearInterval(id);
    },
  };
}

export function createLiveRadioRoomEngine({
  peerId,
  channel = 'security',
  initialMicMode = 'vad',
  sendSignal,
  sendLiveFrame,
  onLocalSpeakingChange,
  onRemoteSpeakersChange,
  onMeshPeersChange,
  onLevels,
  onHeartbeatTick,
  onMicWarning,
} = {}) {
  let destroyed = false;
  let currentChannel = channel;
  let micMode = initialMicMode; // 'vad' | 'open' | 'muted'
  let pttPressed = false;
  let localStream = null;
  let localAudioTrack = null;
  let hasMicrophone = false;

  let micSourceNode = null;
  let workletOrScriptNode = null;
  let silentSinkGain = null;
  let heartbeatWorker = null;
  let meterMonitorTimer = null;

  let vadOpenUntilMs = 0;
  let isCurrentlyTransmitting = false;
  let preRollSamples8k = null;
  let expectedRemotePeerIds = new Set();

  // Map<remotePeerId, PeerEntry>
  const peersMap = new Map();
  // Map<remotePeerId, { peer_id, user_id, display_name, role, untilMs }>
  const relaySpeakingMap = new Map();

  function syncLocalTrackGate(nowMs = Date.now()) {
    const vadActive = micMode === 'vad' && nowMs < vadOpenUntilMs;
    const shouldOpen =
      hasMicrophone && (pttPressed || micMode === 'open' || vadActive);

    if (localAudioTrack && localAudioTrack.enabled !== shouldOpen) {
      localAudioTrack.enabled = shouldOpen;
    }

    if (shouldOpen !== isCurrentlyTransmitting) {
      isCurrentlyTransmitting = shouldOpen;
      onLocalSpeakingChange?.(shouldOpen);
      sendSignal?.({
        channel: currentChannel,
        peer_id: peerId,
        signal_type: 'talking_state',
        data: { talking: shouldOpen, mic_mode: micMode },
      });
      if (!shouldOpen) {
        onLevels?.(IDLE_BAR_LEVELS);
      }
    }

    return shouldOpen;
  }

  function needsRelayFallback() {
    // Send lightweight 250ms μ-law relay frames if any peer on channel isn't yet 'connected' via WebRTC,
    // or when expectedRemotePeerIds is empty (e.g., serverless/cloud listener not yet discovered via P2P)
    if (expectedRemotePeerIds.size === 0) return true;
    for (const remoteId of expectedRemotePeerIds) {
      if (remoteId === peerId) continue;
      const entry = peersMap.get(remoteId);
      if (!entry || !entry.isConnected || !entry.hasRemoteAudio) {
        return true;
      }
    }
    return false;
  }

  function handleIncomingAudioMeter(rms) {
    if (destroyed) return;
    const now = Date.now();
    if (micMode === 'vad' && rms >= VAD_TRIGGER_RMS) {
      vadOpenUntilMs = now + VAD_HANG_MS;
    }
    const open = syncLocalTrackGate(now);
    if (open) {
      onLevels?.(computeBarsFromRms(rms));
    }
  }

  function handleIncomingAudioFrame8k(rms, samples8k) {
    if (destroyed) return;
    const now = Date.now();
    const wasTransmitting = isCurrentlyTransmitting;
    if (micMode === 'vad' && rms >= VAD_TRIGGER_RMS) {
      vadOpenUntilMs = now + VAD_HANG_MS;
    }
    const open = syncLocalTrackGate(now);

    if (!open) {
      preRollSamples8k = samples8k;
      return;
    }

    if (needsRelayFallback()) {
      // Flush pre-roll 250ms syllable buffer on speech onset so zero words are clipped!
      if (!wasTransmitting && preRollSamples8k) {
        const preB64 = encodeFloat32ToMuLawBase64(preRollSamples8k);
        preRollSamples8k = null;
        if (preB64) {
          sendLiveFrame?.({
            channel: currentChannel,
            peer_id: peerId,
            sample_rate: 8000,
            ulaw_b64: preB64,
            is_emergency: currentChannel === 'emergency',
          });
        }
      }

      const ulawB64 = encodeFloat32ToMuLawBase64(samples8k);
      if (ulawB64) {
        sendLiveFrame?.({
          channel: currentChannel,
          peer_id: peerId,
          sample_rate: 8000,
          ulaw_b64: ulawB64,
          is_emergency: currentChannel === 'emergency',
        });
      }
    } else {
      preRollSamples8k = null;
    }
  }

  function emitMeshSummary() {
    let connectedCount = 0;
    for (const entry of peersMap.values()) {
      if (entry.isConnected) connectedCount += 1;
    }
    onMeshPeersChange?.(connectedCount);
  }

  function cleanupPeer(remotePeerId) {
    const entry = peersMap.get(remotePeerId);
    if (!entry) return;
    peersMap.delete(remotePeerId);
    try {
      entry.analyserSource?.disconnect();
      entry.analyser?.disconnect();
    } catch {
      // ignore
    }
    if (entry.audioEl) {
      try {
        entry.audioEl.pause();
        entry.audioEl.srcObject = null;
        entry.audioEl.remove();
      } catch {
        // ignore
      }
    }
    try {
      entry.pc.close();
    } catch {
      // ignore
    }
    emitMeshSummary();
  }

  function ensurePeerConnection(remotePeerId, meta = {}) {
    if (!remotePeerId || remotePeerId === peerId || destroyed) return null;
    if (typeof RTCPeerConnection === 'undefined') return null;

    let entry = peersMap.get(remotePeerId);
    if (entry) {
      if (meta.display_name) entry.display_name = meta.display_name;
      if (meta.role) entry.role = meta.role;
      if (meta.user_id) entry.user_id = meta.user_id;
      return entry;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    entry = {
      peer_id: remotePeerId,
      user_id: meta.user_id || remotePeerId,
      display_name: meta.display_name || 'زميل متصل',
      role: meta.role || 'security',
      pc,
      makingOffer: false,
      ignoreOffer: false,
      isPolite: String(peerId) < String(remotePeerId),
      pendingCandidates: [],
      isConnected: false,
      hasRemoteAudio: false,
      remoteSpeaking: false,
      audioEl: null,
      analyser: null,
      analyserSource: null,
      freqBuf: null,
    };
    peersMap.set(remotePeerId, entry);

    if (localStream && localAudioTrack) {
      pc.addTrack(localAudioTrack, localStream);
    } else {
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        // ignore
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && !destroyed) {
        sendSignal?.({
          channel: currentChannel,
          peer_id: peerId,
          target_peer_id: remotePeerId,
          signal_type: 'ice',
          data: { candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate },
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      if (destroyed) return;
      // Only impolite peer auto-initiates initial negotiation to avoid simultaneous glare
      if (entry.isPolite && pc.signalingState === 'stable' && !pc.remoteDescription) {
        return;
      }
      try {
        entry.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        sendSignal?.({
          channel: currentChannel,
          peer_id: peerId,
          target_peer_id: remotePeerId,
          signal_type: 'offer',
          data: { sdp: pc.localDescription },
        });
      } catch {
        // ignore transient negotiation errors
      } finally {
        entry.makingOffer = false;
      }
    };

    const updateConnFlag = () => {
      const state = pc.connectionState || pc.iceConnectionState;
      entry.isConnected = state === 'connected' || state === 'completed';
      emitMeshSummary();
      if (state === 'failed' && !entry.isPolite) {
        try {
          pc.restartIce?.();
        } catch {
          // ignore
        }
      }
    };

    pc.onconnectionstatechange = updateConnFlag;
    pc.oniceconnectionstatechange = updateConnFlag;

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || new MediaStream([ev.track]);
      entry.hasRemoteAudio = true;

      if (typeof document !== 'undefined') {
        if (!entry.audioEl) {
          const el = document.createElement('audio');
          el.setAttribute('playsinline', 'true');
          el.setAttribute('webkit-playsinline', 'true');
          el.autoplay = true;
          el.volume = 1.0;
          el.style.display = 'none';
          document.body.appendChild(el);
          entry.audioEl = el;
        }
        entry.audioEl.srcObject = stream;
        entry.audioEl.play().catch(() => {});
      }

      // Attach WebAudio analyser so we detect simultaneous remote speakers even without extra signaling
      const ctx = getSharedAudioContext();
      if (ctx && !entry.analyser) {
        try {
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.65;
          src.connect(analyser);
          entry.analyserSource = src;
          entry.analyser = analyser;
          entry.freqBuf = new Uint8Array(analyser.frequencyBinCount);
        } catch {
          // optional meter
        }
      }
      emitMeshSummary();
    };

    return entry;
  }

  async function initiateOfferTo(entry) {
    if (!entry || destroyed) return;
    const { pc, peer_id: remotePeerId } = entry;
    if (entry.makingOffer || pc.signalingState !== 'stable') return;
    try {
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      sendSignal?.({
        channel: currentChannel,
        peer_id: peerId,
        target_peer_id: remotePeerId,
        signal_type: 'offer',
        data: { sdp: pc.localDescription },
      });
    } catch {
      // ignore
    } finally {
      entry.makingOffer = false;
    }
  }

  async function setupAudioCaptureGraph(stream) {
    const ctx = unlockWalkieAudio({ fromTrustedGesture: true }) || getSharedAudioContext({ allowCreateWithoutCheck: true });
    if (!ctx || !stream) return;

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    micSourceNode = ctx.createMediaStreamSource(stream);
    silentSinkGain = ctx.createGain();
    silentSinkGain.gain.value = 0;
    silentSinkGain.connect(ctx.destination);

    // Prefer dedicated AudioWorklet thread (runs uninterrupted when screen is locked!)
    if (ctx.audioWorklet && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        if (!workletLoadedForCtx.has(ctx)) {
          const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          try {
            await ctx.audioWorklet.addModule(url);
            workletLoadedForCtx.add(ctx);
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        const workletNode = new AudioWorkletNode(ctx, 'zayed-walkie-live-proc');
        workletNode.port.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg) return;
          if (msg.type === 'meter') {
            handleIncomingAudioMeter(msg.rms);
          } else if (msg.type === 'frame' && msg.samples8k) {
            handleIncomingAudioFrame8k(msg.rms, msg.samples8k);
          }
        };
        micSourceNode.connect(workletNode);
        workletNode.connect(silentSinkGain);
        workletOrScriptNode = workletNode;
        return;
      } catch {
        // Fallback to ScriptProcessorNode below
      }
    }

    // Fallback ScriptProcessorNode for older WebViews
    if (typeof ctx.createScriptProcessor === 'function') {
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      const ratio = ctx.sampleRate / 8000;
      let inPos = 0;
      let acc = 0;
      let count = 0;
      let frameBuf = new Float32Array(2000);
      let frameIdx = 0;

      sp.onaudioprocess = (ev) => {
        if (destroyed) return;
        const ch = ev.inputBuffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) {
          acc += ch[i];
          count += 1;
          inPos += 1;
          if (inPos >= ratio) {
            inPos -= ratio;
            const s = count > 0 ? acc / count : ch[i];
            acc = 0;
            count = 0;
            frameBuf[frameIdx++] = s;
            if (frameIdx >= 2000) {
              let sum = 0;
              for (let k = 0; k < 2000; k++) sum += frameBuf[k] * frameBuf[k];
              const rms = Math.sqrt(sum / 2000);
              handleIncomingAudioMeter(rms);
              handleIncomingAudioFrame8k(rms, new Float32Array(frameBuf));
              frameIdx = 0;
            }
          }
        }
      };
      micSourceNode.connect(sp);
      sp.connect(silentSinkGain);
      workletOrScriptNode = sp;
    }
  }

  function pollRemoteSpeakersAndMeters() {
    if (destroyed) return;
    const now = Date.now();
    const activeRemoteSpeakers = [];
    let maxRemoteEnergy = 0;

    for (const entry of peersMap.values()) {
      let speakingViaWebRtc = false;
      if (entry.isConnected && entry.analyser && entry.freqBuf) {
        entry.analyser.getByteFrequencyData(entry.freqBuf);
        let sum = 0;
        for (let i = 1; i < 14; i++) {
          sum += entry.freqBuf[i] || 0;
        }
        const avg = sum / (13 * 255);
        if (avg > 0.085) {
          speakingViaWebRtc = true;
          if (avg > maxRemoteEnergy) maxRemoteEnergy = avg;
        }
      }
      entry.remoteSpeaking = speakingViaWebRtc;
      if (speakingViaWebRtc) {
        activeRemoteSpeakers.push({
          peer_id: entry.peer_id,
          user_id: entry.user_id,
          display_name: entry.display_name,
          role: entry.role,
          transport: 'webrtc',
        });
      }
    }

    for (const [rPeerId, relaySpeaker] of relaySpeakingMap.entries()) {
      if (relaySpeaker.untilMs < now) {
        relaySpeakingMap.delete(rPeerId);
        continue;
      }
      if (!activeRemoteSpeakers.some((s) => s.peer_id === rPeerId)) {
        activeRemoteSpeakers.push({
          peer_id: relaySpeaker.peer_id,
          user_id: relaySpeaker.user_id,
          display_name: relaySpeaker.display_name,
          role: relaySpeaker.role,
          transport: 'relay',
        });
      }
    }

    onRemoteSpeakersChange?.(activeRemoteSpeakers);

    if (!isCurrentlyTransmitting) {
      if (maxRemoteEnergy > 0.08) {
        onLevels?.(computeBarsFromRms(maxRemoteEnergy * 0.35));
      } else if (activeRemoteSpeakers.length === 0) {
        onLevels?.(IDLE_BAR_LEVELS);
      }
    }

    // Also close expired VAD gate cleanly when user stops speaking
    syncLocalTrackGate(now);
  }

  async function start() {
    if (destroyed) return { ok: false };

    const isInsecureNonLocal =
      typeof window !== 'undefined' &&
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        localAudioTrack = localStream.getAudioTracks()[0] || null;
        hasMicrophone = Boolean(localAudioTrack);
        if (localAudioTrack) {
          localAudioTrack.enabled = micMode === 'open';
        }
        await setupAudioCaptureGraph(localStream);
      } catch (err) {
        hasMicrophone = false;
        if (isInsecureNonLocal) {
          onMicWarning?.(
            'تم فتح الاستماع الحي للقناة — لتشغيل المايكروفون على الهاتف افتح الرابط عبر HTTPS أو localhost'
          );
        } else if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          onMicWarning?.(
            'تم فتح الاستماع الحي للقناة — اسمح بصلاحية المايكروفون من شريط المتصفح للتحدث مع الفريق'
          );
        } else {
          onMicWarning?.(
            'تم فتح الاستماع الحي للقناة بدون مايكروفون (وضع الاستماع المباشر)'
          );
        }
      }
    } else if (isInsecureNonLocal) {
      onMicWarning?.(
        'تم فتح الاستماع الحي للقناة — لتشغيل المايكروفون افتح النظام عبر رابط HTTPS آمن أو localhost'
      );
    }

    playPttStartChirp();

    // Unthrottled background Worker heartbeat + 140ms speaker energy monitor
    heartbeatWorker = createBackgroundHeartbeatWorker(2200, () => {
      if (destroyed) return;
      pollRemoteSpeakersAndMeters();
      onHeartbeatTick?.();
    });

    meterMonitorTimer = setInterval(pollRemoteSpeakersAndMeters, 140);

    // Announce live room join to all peers on this channel
    await sendSignal?.({
      channel: currentChannel,
      peer_id: peerId,
      signal_type: 'join',
      data: { mic_mode: micMode, has_mic: hasMicrophone },
    });

    syncLocalTrackGate();
    return { ok: true, hasMicrophone };
  }

  async function handleSignal(envelope) {
    if (destroyed || !envelope) return;
    if (envelope.channel !== currentChannel && envelope.channel !== 'emergency') return;
    const remotePeerId = envelope.from_peer_id;
    if (!remotePeerId || remotePeerId === peerId) return;
    if (envelope.target_peer_id && envelope.target_peer_id !== peerId) return;

    expectedRemotePeerIds.add(remotePeerId);

    const { signal_type: sigType, data } = envelope;
    if (sigType === 'leave') {
      expectedRemotePeerIds.delete(remotePeerId);
      relaySpeakingMap.delete(remotePeerId);
      cleanupPeer(remotePeerId);
      pollRemoteSpeakersAndMeters();
      return;
    }

    if (sigType === 'talking_state') {
      if (data?.talking) {
        relaySpeakingMap.set(remotePeerId, {
          peer_id: remotePeerId,
          user_id: envelope.user_id,
          display_name: envelope.display_name || 'زميل متصل',
          role: envelope.role || 'security',
          untilMs: Date.now() + 3500,
        });
      } else {
        relaySpeakingMap.delete(remotePeerId);
      }
      pollRemoteSpeakersAndMeters();
      return;
    }

    const entry = ensurePeerConnection(remotePeerId, envelope);
    if (!entry) return;
    const { pc } = entry;

    if (sigType === 'join') {
      // Reply with targeted join-ack once so both sides discover each other immediately
      if (!data?.ack) {
        sendSignal?.({
          channel: currentChannel,
          peer_id: peerId,
          target_peer_id: remotePeerId,
          signal_type: 'join',
          data: { ack: true, mic_mode: micMode, has_mic: hasMicrophone },
        });
      }
      if (!entry.isPolite && !entry.isConnected) {
        await initiateOfferTo(entry);
      }
      return;
    }

    if (sigType === 'offer' && data?.sdp) {
      try {
        const offerCollision =
          entry.makingOffer || pc.signalingState !== 'stable';
        entry.ignoreOffer = !entry.isPolite && offerCollision;
        if (entry.ignoreOffer) return;

        if (offerCollision) {
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

        while (entry.pendingCandidates.length > 0) {
          const cand = entry.pendingCandidates.shift();
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal?.({
          channel: currentChannel,
          peer_id: peerId,
          target_peer_id: remotePeerId,
          signal_type: 'answer',
          data: { sdp: pc.localDescription },
        });
      } catch {
        // ignore transient SDP mismatch
      }
      return;
    }

    if (sigType === 'answer' && data?.sdp) {
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          while (entry.pendingCandidates.length > 0) {
            const cand = entry.pendingCandidates.shift();
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
      return;
    }

    if (sigType === 'ice' && data?.candidate) {
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          entry.pendingCandidates.push(data.candidate);
        }
      } catch {
        // ignore benign late candidate
      }
    }
  }

  function handleLiveFrame(packet) {
    if (destroyed || !packet?.ulaw_b64) return;
    const remotePeerId = packet.from_peer_id || packet.sender_id;
    if (!remotePeerId || remotePeerId === peerId) return;
    if (packet.channel !== currentChannel && packet.channel !== 'emergency') return;

    expectedRemotePeerIds.add(remotePeerId);
    relaySpeakingMap.set(remotePeerId, {
      peer_id: remotePeerId,
      user_id: packet.sender_id || remotePeerId,
      display_name: packet.sender_name || 'زميل على الخط',
      role: packet.sender_role || 'security',
      untilMs: Date.now() + 900,
    });

    // Deduplication: if this peer already has a live connected WebRTC audio stream, skip μ-law playback so there is ZERO echo!
    const peerEntry = peersMap.get(remotePeerId);
    if (peerEntry && peerEntry.isConnected && peerEntry.hasRemoteAudio) {
      pollRemoteSpeakersAndMeters();
      return;
    }

    playIncomingLiveMuLawFrame(remotePeerId, packet.ulaw_b64, {
      sampleRate: packet.sample_rate || 8000,
      onLevel: (bars) => {
        if (!isCurrentlyTransmitting) {
          onLevels?.(bars);
        }
      },
    });
    pollRemoteSpeakersAndMeters();
  }

  function syncActiveUnitsFromServer(units = []) {
    if (destroyed || !Array.isArray(units)) return;
    const livePeerSet = new Set();
    for (const u of units) {
      const rId = u.peer_id || u.user_id;
      if (!rId || rId === peerId) continue;
      if (u.live_on !== false) {
        livePeerSet.add(rId);
        if (!peersMap.has(rId)) {
          const entry = ensurePeerConnection(rId, u);
          if (entry && !entry.isPolite) {
            initiateOfferTo(entry);
          }
        }
      }
    }
    expectedRemotePeerIds = livePeerSet;
    for (const existingPeerId of Array.from(peersMap.keys())) {
      if (!livePeerSet.has(existingPeerId)) {
        cleanupPeer(existingPeerId);
      }
    }
  }

  function setMicMode(nextMode) {
    if (!['vad', 'open', 'muted'].includes(nextMode)) return;
    micMode = nextMode;
    if (nextMode !== 'vad') {
      vadOpenUntilMs = 0;
    }
    syncLocalTrackGate();
  }

  function setPttPressed(pressed) {
    const next = Boolean(pressed);
    if (pttPressed === next) return;
    pttPressed = next;
    if (next) {
      playPttStartChirp();
    } else {
      playPttEndSquelch();
    }
    syncLocalTrackGate();
  }

  function stop() {
    if (destroyed) return;
    destroyed = true;

    try {
      sendSignal?.({
        channel: currentChannel,
        peer_id: peerId,
        signal_type: 'leave',
        data: null,
      });
    } catch {
      // ignore
    }

    heartbeatWorker?.stop();
    if (meterMonitorTimer) clearInterval(meterMonitorTimer);

    for (const rId of Array.from(peersMap.keys())) {
      cleanupPeer(rId);
    }
    relaySpeakingMap.clear();

    try {
      workletOrScriptNode?.disconnect();
      micSourceNode?.disconnect();
      silentSinkGain?.disconnect();
    } catch {
      // ignore
    }

    if (localStream) {
      for (const track of localStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
    localStream = null;
    localAudioTrack = null;

    playPttEndSquelch();
    onLocalSpeakingChange?.(false);
    onRemoteSpeakersChange?.([]);
    onMeshPeersChange?.(0);
    onLevels?.(IDLE_BAR_LEVELS);
  }

  return {
    start,
    stop,
    setMicMode,
    setPttPressed,
    handleSignal,
    handleLiveFrame,
    syncActiveUnitsFromServer,
    hasMicrophone: () => hasMicrophone,
  };
}
