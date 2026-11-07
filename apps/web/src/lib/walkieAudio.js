/**
 * محرك الصوت التكتيكي والخط الحي بالخلفية للاسلكي زايد مارت (v3 Police Dispatch & Loudspeaker Boost)
 * - مخرج صوتي مزدوج دائم (WebAudio Destination المباشر + حامل الخلفية MediaStreamDestination) لمنع انقطاع الصوت عند فتح المايك على الموبايل
 * - مضخم صوت لاسلكي تكتيكي (DynamicsCompressor + 2.35x Loudspeaker Gain) لرفع صوت السماعة الخارجية على الهاتف
 * - محول فوري من إطارات 8kHz μ-law إلى ملف صوتي قياسي (WAV 16-bit PCM) متوافق 100% مع أندرويد وآيفون والكمبيوتر
 * - صافرة طوارئ الشرطة (Tetra Emergency Siren) + إشعارات النظام بالخلفية وقفل الشاشة
 */

let sharedAudioCtx = null;
let masterBusGain = null;
let masterCompressor = null;
let masterPostGain = null;
let activeWakeLock = null;
let userGestureConfirmed = false;

// Background Keep-Alive Carrier state
const bgCarrier = {
  active: false,
  audioEl: null,
  streamDest: null,
  osc: null,
  oscGain: null,
  usingCarrierOutput: false,
};

// Precomputed 256-entry μ-law decode table (0.02ms decode, 14-bit speech dynamic range in 8 bits)
const LN_256 = Math.log(256);
const MULAW_DECODE_TABLE = (() => {
  const table = new Float32Array(256);
  for (let b = 0; b < 256; b++) {
    const u = b ^ 0xff;
    const sign = u & 0x80 ? -1 : 1;
    const quant = (u & 0x7f) / 128;
    const mag = (Math.pow(256, quant) - 1) / 255;
    table[b] = sign * mag;
  }
  return table;
})();

// Per-peer jitter buffer playback cursors so multiple speakers mix simultaneously with zero gaps
const peerScheduleMap = new Map();

export const IDLE_BAR_LEVELS = [
  0.14, 0.18, 0.14, 0.22, 0.16, 0.24, 0.24, 0.16, 0.22, 0.14, 0.18, 0.14,
];

function hasStickyUserActivation() {
  if (userGestureConfirmed) return true;
  if (typeof navigator !== 'undefined' && navigator.userActivation) {
    return Boolean(
      navigator.userActivation.isActive || navigator.userActivation.hasBeenActive
    );
  }
  return false;
}

export function getSharedAudioContext({ allowCreateWithoutCheck = false } = {}) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    if (!allowCreateWithoutCheck && !hasStickyUserActivation()) {
      return null;
    }
    try {
      sharedAudioCtx = new AudioCtx({ latencyHint: 'interactive' });
      masterBusGain = null;
      masterCompressor = null;
      masterPostGain = null;
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

/**
 * يضمن دائماً توصيل الصوت إلى سماعة الجهاز المباشرة (ctx.destination) بالإضافة إلى حامل الخلفية (streamDest)
 * حتى لا ينقطع الصوت أبداً على الهواتف عند فتح المايكروفون (getUserMedia).
 */
export function getOutputDestination(ctx) {
  const targetCtx = ctx || getSharedAudioContext({ allowCreateWithoutCheck: true });
  if (!targetCtx) return null;

  if (!masterBusGain || masterBusGain.context !== targetCtx) {
    masterBusGain = targetCtx.createGain();
    masterBusGain.gain.value = 1.35;

    try {
      masterCompressor = targetCtx.createDynamicsCompressor();
      masterCompressor.threshold.value = -24;
      masterCompressor.knee.value = 12;
      masterCompressor.ratio.value = 6;
      masterCompressor.attack.value = 0.003;
      masterCompressor.release.value = 0.15;

      masterPostGain = targetCtx.createGain();
      masterPostGain.gain.value = 2.15;

      masterBusGain.connect(masterCompressor);
      masterCompressor.connect(masterPostGain);
    } catch {
      masterCompressor = null;
      masterPostGain = masterBusGain;
    }

    rewireMasterBusOutput();
  }
  return masterBusGain;
}

function rewireMasterBusOutput() {
  const ctx = sharedAudioCtx;
  const outNode = masterPostGain || masterBusGain;
  if (!ctx || !outNode) return;
  try {
    outNode.disconnect();
  } catch {
    // ignore
  }
  // 1. ALWAYS connect directly to hardware speaker destination so mobile getUserMedia never mutes WebAudio!
  try {
    outNode.connect(ctx.destination);
  } catch {
    // ignore
  }
  // 2. Also connect in parallel to background carrier stream when active for lock-screen / background playback
  if (bgCarrier.usingCarrierOutput && bgCarrier.streamDest && bgCarrier.streamDest.context === ctx) {
    try {
      outNode.connect(bgCarrier.streamDest);
    } catch {
      // ignore
    }
  }
}

export function ensureAudioPipelineResumed() {
  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (bgCarrier.active && bgCarrier.audioEl && bgCarrier.audioEl.paused) {
      bgCarrier.audioEl.play().catch(() => {});
    }
  } catch {
    // ignore
  }
}

/**
 * يُستدعى داخل أي تفاعل مستخدم لفتح محرك الصوت وطلب صلاحية الإشعارات بالخلفية
 */
export function unlockWalkieAudio({ fromTrustedGesture = false } = {}) {
  if (fromTrustedGesture) {
    userGestureConfirmed = true;
  }
  if (!hasStickyUserActivation()) return null;

  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    getOutputDestination(ctx);
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    if (bgCarrier.active && bgCarrier.audioEl && bgCarrier.audioEl.paused) {
      bgCarrier.audioEl.play().catch(() => {});
    }
    return ctx;
  } catch {
    return null;
  }
}

export async function requestWalkieNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  } catch {
    return 'default';
  }
}

export function triggerHaptic(pattern = [35]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore on desktop / unsupported browsers
  }
}

/**
 * تشغيل حامل الصوت المستمر في الخلفية + شاشة القفل (MediaSession + HTMLAudioElement Carrier)
 * يضمن عدم إيقاف المتصفح للصوت الحي أو الاستقبال التلقائي عند تصغير الشاشة أو قفل الموبايل
 */
export async function startBackgroundRadioCarrier({
  channelLabel = 'قناة الأمن والبوابة',
  channelCode = 'CH-01',
  speakerText = 'وضع الاستقبال التلقائي كالشرطة نشط بالخلفية',
  onToggleMicMute,
  onPowerOff,
} = {}) {
  userGestureConfirmed = true;
  const ctx = unlockWalkieAudio({ fromTrustedGesture: true });
  if (!ctx || typeof document === 'undefined') return false;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    if (!bgCarrier.streamDest || bgCarrier.streamDest.context !== ctx) {
      bgCarrier.streamDest = ctx.createMediaStreamDestination();
    }

    // Sub-audible 22Hz carrier at 0.00012 gain prevents mobile OS hardware DSP from suspending "digital zero" streams
    if (!bgCarrier.osc) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 22;
      oscGain.gain.value = 0.00012;
      osc.connect(oscGain);
      oscGain.connect(bgCarrier.streamDest);
      osc.start();
      bgCarrier.osc = osc;
      bgCarrier.oscGain = oscGain;
    }

    if (!bgCarrier.audioEl) {
      const el = document.createElement('audio');
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      el.autoplay = true;
      el.volume = 1.0;
      el.style.display = 'none';
      document.body.appendChild(el);
      bgCarrier.audioEl = el;
    }

    if (bgCarrier.audioEl.srcObject !== bgCarrier.streamDest.stream) {
      bgCarrier.audioEl.srcObject = bgCarrier.streamDest.stream;
    }

    bgCarrier.active = true;
    bgCarrier.usingCarrierOutput = true;
    getOutputDestination(ctx);
    rewireMasterBusOutput();

    await bgCarrier.audioEl.play().catch(() => {});

    updateBackgroundRadioMediaSession({
      channelLabel,
      channelCode,
      speakerText,
      onToggleMicMute,
      onPowerOff,
    });

    return true;
  } catch {
    bgCarrier.usingCarrierOutput = false;
    rewireMasterBusOutput();
    return false;
  }
}

export function updateBackgroundRadioMediaSession({
  channelLabel = 'قناة الأمن والبوابة',
  channelCode = 'CH-01',
  speakerText = 'الخط الحي مفتوح بالخلفية',
  onToggleMicMute,
  onPowerOff,
} = {}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `لاسلكي زايد مارت (${channelCode})`,
        artist: speakerText,
        album: channelLabel,
        artwork: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    }
    navigator.mediaSession.playbackState = 'playing';

    const safeSetHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this OS/browser
      }
    };

    safeSetHandler('play', () => {
      ensureAudioPipelineResumed();
      onToggleMicMute?.(false);
    });
    safeSetHandler('pause', () => {
      ensureAudioPipelineResumed();
      onToggleMicMute?.();
    });
    safeSetHandler('stop', () => {
      onPowerOff?.();
    });
    safeSetHandler('hangup', () => {
      onPowerOff?.();
    });
  } catch {
    // ignore
  }
}

export function stopBackgroundRadioCarrier() {
  bgCarrier.active = false;
  bgCarrier.usingCarrierOutput = false;
  rewireMasterBusOutput();

  try {
    bgCarrier.osc?.stop();
    bgCarrier.osc?.disconnect();
    bgCarrier.oscGain?.disconnect();
  } catch {
    // ignore
  }
  bgCarrier.osc = null;
  bgCarrier.oscGain = null;

  if (bgCarrier.audioEl) {
    try {
      bgCarrier.audioEl.pause();
      bgCarrier.audioEl.srcObject = null;
    } catch {
      // ignore
    }
  }

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {
      // ignore
    }
  }
}

/**
 * ترميز مصفوفة صوتية Float32 [-1..1] إلى G.711 μ-law Base64 لبث الإطارات الحية (250ms = ~2.6KB)
 */
export function encodeFloat32ToMuLawBase64(samples) {
  if (!samples || samples.length === 0) return '';
  const len = samples.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    const s = samples[i];
    const sign = s < 0 ? 0x80 : 0x00;
    const mag = Math.min(1, Math.abs(s));
    const compressed = Math.log(1 + 255 * mag) / LN_256;
    const quant = Math.min(127, Math.floor(compressed * 128));
    bytes[i] = (sign | quant) ^ 0xff;
  }

  let binary = '';
  const step = 0x4000;
  for (let i = 0; i < len; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

export function decodeMuLawBase64ToFloat32(ulawB64) {
  if (!ulawB64 || typeof atob !== 'function') return null;
  try {
    const binary = atob(ulawB64);
    const len = binary.length;
    if (len === 0) return null;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = MULAW_DECODE_TABLE[binary.charCodeAt(i) & 0xff];
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * تحويل إطارات G.711 μ-law الملتقطة أثناء التحدث إلى مقطع WAV قياسي (16-bit PCM RIFF WAV DataURL)
 * يعمل على جميع الهواتف (Android / iPhone / PC) بنسبة 100% لضمان سماع النداء حتى لو فاتت إطارات البث الحي.
 */
export function encodeMuLawFramesToWavDataUrl(ulawFrames = [], sampleRate = 8000) {
  if (!Array.isArray(ulawFrames) || ulawFrames.length === 0 || typeof btoa !== 'function') {
    return '';
  }
  try {
    const decodedChunks = [];
    let totalSamples = 0;
    const maxSamples = sampleRate * 28; // Cap at 28s so payload stays compact (<450KB)

    for (const b64 of ulawFrames) {
      const f32 = decodeMuLawBase64ToFloat32(b64);
      if (f32 && f32.length > 0) {
        decodedChunks.push(f32);
        totalSamples += f32.length;
        if (totalSamples >= maxSamples) break;
      }
    }

    if (totalSamples < sampleRate * 0.35) {
      return '';
    }

    const bytesPerSample = 2; // 16-bit PCM
    const dataByteLength = totalSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataByteLength);
    const view = new DataView(buffer);

    const writeAscii = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataByteLength, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format = 1
    view.setUint16(22, 1, true); // Mono = 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true); // 16 bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, dataByteLength, true);

    let byteOffset = 44;
    for (const chunk of decodedChunks) {
      for (let i = 0; i < chunk.length; i++) {
        // Apply gentle 1.35x speech normalization before 16-bit quantization
        const s = Math.max(-1, Math.min(1, chunk[i] * 1.35));
        const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        view.setInt16(byteOffset, int16, true);
        byteOffset += 2;
      }
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const step = 0x4000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return `data:audio/wav;base64,${btoa(binary)}`;
  } catch {
    return '';
  }
}

export function computeBarsFromRms(rms) {
  const norm = Math.min(1, Math.max(0, rms * 5.2));
  if (norm < 0.03) return IDLE_BAR_LEVELS;
  return Array.from({ length: 12 }, (_, idx) => {
    const wave = Math.sin(Date.now() / 75 + idx * 0.75) * 0.18 + 0.82;
    const centerShape = 1 - Math.abs(idx - 5.5) / 9;
    return Math.min(1, Math.max(0.14, norm * wave * centerShape * 1.35));
  });
}

/**
 * تشغيل فوري متزامن لإطار صوتي حي وارد (250ms μ-law) مع مضخم صوت السماعة الخارجية للهاتف
 */
export function playIncomingLiveMuLawFrame(
  peerKey,
  ulawB64,
  { sampleRate = 8000, isEmergency = false, onLevel } = {}
) {
  ensureAudioPipelineResumed();
  const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
  if (!ctx || !ulawB64) return false;

  const samples = decodeMuLawBase64ToFloat32(ulawB64);
  if (!samples || samples.length === 0) return false;

  const dest = getOutputDestination(ctx);
  if (!dest) return false;

  const key = peerKey || 'default_peer';
  const now = ctx.currentTime;
  let sched = peerScheduleMap.get(key);
  const isNewBurst = !sched || sched.nextTime < now - 0.18;

  if (!sched || sched.nextTime < now + 0.01) {
    // 85ms jitter cushion on burst start keeps continuous 250ms packets silky smooth
    sched = { nextTime: now + 0.085, lastFrameAtMs: Date.now() };
  }

  // Gentle 2.5ms anti-click ramp at the start of a new speech burst
  if (isNewBurst && samples.length > 32) {
    const fadeSamples = Math.min(24, samples.length);
    for (let i = 0; i < fadeSamples; i++) {
      samples[i] *= i / fadeSamples;
    }
    if (isEmergency) {
      playIncomingRxChirp({ subtle: false });
    } else {
      playIncomingRxChirp({ subtle: true });
    }
  }

  try {
    const audioBuf = ctx.createBuffer(1, samples.length, sampleRate);
    audioBuf.getChannelData(0).set(samples);

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    // Crisp Police Radio voice filter (highpass 220Hz removes rumble, lowpass 3700Hz removes hiss)
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 220;

    const lpFilter = ctx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.value = 3700;

    const boostGain = ctx.createGain();
    boostGain.gain.value = isEmergency ? 2.1 : 1.65;

    src.connect(hpFilter);
    hpFilter.connect(lpFilter);
    lpFilter.connect(boostGain);
    boostGain.connect(dest);

    src.start(sched.nextTime);
    sched.nextTime += audioBuf.duration;
    sched.lastFrameAtMs = Date.now();
    peerScheduleMap.set(key, sched);

    if (onLevel) {
      let sumSq = 0;
      const step = Math.max(1, Math.floor(samples.length / 120));
      let count = 0;
      for (let i = 0; i < samples.length; i += step) {
        sumSq += samples[i] * samples[i];
        count += 1;
      }
      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      onLevel(computeBarsFromRms(rms));
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * نغمة بدء التحدث التكتيكية (Motorola Talk-Permit Three-Tone Chirp)
 */
export function playPttStartChirp() {
  triggerHaptic([35]);
  ensureAudioPipelineResumed();
  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const tones = [
      { freq: 910, start: 0, dur: 0.028 },
      { freq: 1365, start: 0.034, dur: 0.028 },
      { freq: 1820, start: 0.068, dur: 0.052 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.001, now + t.start);
      gain.gain.linearRampToValueAtTime(0.18, now + t.start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.005);
    }
  } catch {
    // Ignore
  }
}

/**
 * صوت نهاية الإرسال (Radio Squelch Tail + Roger Beep)
 */
export function playPttEndSquelch() {
  triggerHaptic([20]);
  ensureAudioPipelineResumed();
  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const beepGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, now);
    beepGain.gain.setValueAtTime(0.001, now);
    beepGain.gain.linearRampToValueAtTime(0.14, now + 0.008);
    beepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(beepGain);
    beepGain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.06);

    const sampleCount = Math.floor(ctx.sampleRate * 0.07);
    const noiseBuf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1450, now + 0.05);
    filter.Q.setValueAtTime(1.4, now + 0.05);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.09, now + 0.05);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    noiseSrc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(dest);
    noiseSrc.start(now + 0.05);
  } catch {
    // Ignore
  }
}

/**
 * نغمة فتح استقبال نداء وارد من زميل على القناة (Police Dispatch Squelch Break)
 */
export function playIncomingRxChirp({ subtle = false } = {}) {
  if (!subtle) triggerHaptic([50, 30, 50]);
  ensureAudioPipelineResumed();
  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const peak = subtle ? 0.09 : 0.2;
    const notes = [880, 1318.51, 1760];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.036);
      gain.gain.setValueAtTime(0.001, now + i * 0.036);
      gain.gain.linearRampToValueAtTime(peak, now + i * 0.036 + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.036 + 0.042);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.036);
      osc.stop(now + i * 0.036 + 0.046);
    });
  } catch {
    // Ignore
  }
}

/**
 * جرس انتباه لاسلكي عاجل / صافرة طوارئ الشرطة (Police Tetra Emergency Dispatch Siren)
 */
export function playUrgentPagerTone() {
  triggerHaptic([160, 70, 160, 70, 240]);
  ensureAudioPipelineResumed();
  try {
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const pattern = [987.77, 1318.51, 987.77, 1318.51, 1567.98, 1975.53];
    pattern.forEach((freq, idx) => {
      const start = now + idx * 0.088;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(start);
      osc.stop(start + 0.085);
    });
  } catch {
    // Ignore
  }
}

export function playPoliceEmergencySiren() {
  playUrgentPagerTone();
}

/**
 * إرسال إشعار نظام فوري (Push Notification) عبر Service Worker عند فتح زميل للخط أو التحدث أو الطوارئ
 */
export function notifyWalkieBackgroundAlert(
  title,
  body,
  { isEmergency = false, forceShow = false, tag = 'zayed-walkie-live' } = {}
) {
  if (typeof document === 'undefined') return;
  const isHidden = document.visibilityState !== 'visible';
  if (!isHidden && !forceShow && !isEmergency) return;

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (reg && typeof reg.showNotification === 'function') {
            return reg.showNotification(title, {
              body,
              icon: '/pwa-192.png',
              badge: '/pwa-192.png',
              tag: isEmergency ? `zayed-walkie-emergency-${Date.now()}` : tag,
              renotify: true,
              requireInteraction: Boolean(isEmergency),
              vibrate: isEmergency
                ? [240, 80, 240, 80, 360]
                : [120, 60, 120, 60, 160],
              data: { isEmergency, at: Date.now() },
            });
          }
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: 'ZAYED_WALKIE_NOTIFY',
              title,
              body,
              isEmergency,
              tag,
            });
          }
          return undefined;
        })
        .catch(() => {});
      return;
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/pwa-192.png',
        tag: isEmergency ? `zayed-walkie-emergency-${Date.now()}` : tag,
      });
    }
  } catch {
    // ignore
  }
}

function dataUrlToArrayBuffer(dataUrl) {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1 || typeof atob !== 'function') return null;
    const b64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * تشغيل مقطع نداء لاسلكي مسجل عبر مضخم WebAudio المباشر (مع بديل تلقائي HTMLAudioElement)
 * يضمن سماع الصوت بأعلى وضوح على سماعة الهاتف الخارجية حتى أثناء فتح المايكروفون!
 */
export function playWalkieAudioClip(
  dataUrl,
  { onLevel, withRadioEffects = true, isEmergency = false } = {}
) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof window === 'undefined') {
      resolve(false);
      return;
    }

    ensureAudioPipelineResumed();

    let settled = false;
    let simInterval = null;
    let safetyTimeout = null;

    function finish(ok) {
      if (settled) return;
      settled = true;
      if (simInterval) clearInterval(simInterval);
      if (safetyTimeout) clearTimeout(safetyTimeout);
      onLevel?.(IDLE_BAR_LEVELS);
      if (ok && withRadioEffects) {
        playPttEndSquelch();
      }
      resolve(ok);
    }

    if (withRadioEffects) {
      if (isEmergency) {
        playUrgentPagerTone();
      } else {
        playIncomingRxChirp();
      }
    }

    if (onLevel) {
      simInterval = setInterval(() => {
        const simulated = Array.from({ length: 12 }, (_, idx) => {
          const centerBoost = 1 - Math.abs(idx - 5.5) / 8;
          return Math.min(1, Math.max(0.16, (0.28 + Math.random() * 0.68) * centerBoost));
        });
        onLevel(simulated);
      }, 95);
    }

    safetyTimeout = setTimeout(() => finish(true), 36000);

    // 1. Primary path: Decode & play through boosted WebAudio masterBusGain (immune to mobile <audio> autoplay blocks!)
    const ctx = getSharedAudioContext({ allowCreateWithoutCheck: true });
    const dest = getOutputDestination(ctx);
    const rawBuffer = dataUrlToArrayBuffer(dataUrl);

    if (ctx && dest && rawBuffer && typeof ctx.decodeAudioData === 'function') {
      ctx
        .decodeAudioData(rawBuffer.slice(0))
        .then((audioBuffer) => {
          if (settled) return;
          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          const gain = ctx.createGain();
          gain.gain.value = isEmergency ? 1.85 : 1.45;
          src.connect(gain);
          gain.connect(dest);
          src.onended = () => finish(true);
          src.start(ctx.currentTime + (withRadioEffects ? 0.09 : 0));
        })
        .catch(() => {
          // 2. Fallback to HTML5 Audio element if browser couldn't decode container in WebAudio
          playViaHtmlAudioElement();
        });
      return;
    }

    playViaHtmlAudioElement();

    function playViaHtmlAudioElement() {
      if (typeof Audio === 'undefined') {
        finish(false);
        return;
      }
      const audio = new Audio(dataUrl);
      audio.preload = 'auto';
      audio.volume = 1.0;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      setTimeout(
        () => {
          if (settled) return;
          audio.play().catch(() => finish(false));
        },
        withRadioEffects ? 85 : 0
      );
    }
  });
}

export async function acquireRadioWakeLock() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
  try {
    if (activeWakeLock) return true;
    activeWakeLock = await navigator.wakeLock.request('screen');
    activeWakeLock.addEventListener('release', () => {
      activeWakeLock = null;
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseRadioWakeLock() {
  try {
    if (activeWakeLock) {
      await activeWakeLock.release();
      activeWakeLock = null;
    }
  } catch {
    activeWakeLock = null;
  }
}
