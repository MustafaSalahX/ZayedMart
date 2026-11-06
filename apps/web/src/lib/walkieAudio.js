/**
 * محرك الصوت التكتيكي والخط الحي بالخلفية للاسلكي زايد مارت (v2 Live Intercom & Background Carrier)
 * - صفر تحذيرات AudioContext (لا يُنشأ إلا بعد نقرة مستخدم معتمدة Click / Keydown / Touchend)
 * - حامل صوتي مستمر بالخلفية (MediaStreamDestination -> HTMLAudioElement + MediaSession Lock-Screen)
 * - ترميز وفك ترميز صوتي حي فوري متعدد المتحدثين (Stateless 8kHz μ-law Jitter-Buffered Mixer)
 */

let sharedAudioCtx = null;
let masterBusGain = null;
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
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === 'suspended' && (allowCreateWithoutCheck || hasStickyUserActivation())) {
    sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

function getOutputDestination(ctx) {
  if (!ctx) return null;
  if (!masterBusGain || masterBusGain.context !== ctx) {
    masterBusGain = ctx.createGain();
    masterBusGain.gain.value = 1.0;
    if (bgCarrier.usingCarrierOutput && bgCarrier.streamDest) {
      masterBusGain.connect(bgCarrier.streamDest);
    } else {
      masterBusGain.connect(ctx.destination);
    }
  }
  return masterBusGain;
}

function rewireMasterBusOutput() {
  const ctx = sharedAudioCtx;
  if (!ctx || !masterBusGain) return;
  try {
    masterBusGain.disconnect();
  } catch {
    // ignore
  }
  if (bgCarrier.usingCarrierOutput && bgCarrier.streamDest) {
    masterBusGain.connect(bgCarrier.streamDest);
  } else {
    masterBusGain.connect(ctx.destination);
  }
}

/**
 * يُستدعى فقط داخل حدث تفاعل معتمد (click / touchend / keydown) لفتح محرك الصوت بدون أي تحذيرات
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
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    return ctx;
  } catch {
    return null;
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
 * يضمن عدم إيقاف المتصفح للصوت الحي أو المايكروفون عند تصغير الشاشة أو قفل الموبايل
 */
export async function startBackgroundRadioCarrier({
  channelLabel = 'قناة الأمن والبوابة',
  channelCode = 'CH-01',
  onToggleMicMute,
  onPowerOff,
} = {}) {
  userGestureConfirmed = true;
  const ctx = unlockWalkieAudio({ fromTrustedGesture: true });
  if (!ctx || typeof document === 'undefined') return false;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (!bgCarrier.streamDest || bgCarrier.streamDest.context !== ctx) {
      bgCarrier.streamDest = ctx.createMediaStreamDestination();
    }

    // Sub-audible 22Hz carrier at 0.00008 gain prevents mobile OS hardware DSP from suspending "digital zero" streams
    if (!bgCarrier.osc) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 22;
      oscGain.gain.value = 0.00008;
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

    await bgCarrier.audioEl.play();
    bgCarrier.active = true;
    bgCarrier.usingCarrierOutput = true;
    rewireMasterBusOutput();

    updateBackgroundRadioMediaSession({
      channelLabel,
      channelCode,
      speakerText: 'الخط الحي مفتوح بالخلفية — جاهز للتحدث والاستماع',
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
        title: `لاسلكي زايد مارت (${channelCode} LIVE)`,
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
      bgCarrier.audioEl?.play?.().catch(() => {});
      onToggleMicMute?.(false);
    });
    safeSetHandler('pause', () => {
      // On headset tap, toggle mic mute while keeping carrier stream alive!
      bgCarrier.audioEl?.play?.().catch(() => {});
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
 * تشغيل فوري متزامن لإطار صوتي حي وارد (250ms μ-law) مع دعم تعدد المتحدثين في نفس اللحظة
 */
export function playIncomingLiveMuLawFrame(
  peerKey,
  ulawB64,
  { sampleRate = 8000, onLevel } = {}
) {
  const ctx = getSharedAudioContext();
  if (!ctx || !ulawB64) return false;
  if (ctx.state === 'suspended' && hasStickyUserActivation()) {
    ctx.resume().catch(() => {});
  }

  const samples = decodeMuLawBase64ToFloat32(ulawB64);
  if (!samples || samples.length === 0) return false;

  const dest = getOutputDestination(ctx);
  if (!dest) return false;

  const key = peerKey || 'default_peer';
  const now = ctx.currentTime;
  let sched = peerScheduleMap.get(key);
  const isNewBurst = !sched || sched.nextTime < now - 0.15;

  if (!sched || sched.nextTime < now + 0.01) {
    // 95ms jitter cushion on burst start keeps continuous 250ms packets silky smooth
    sched = { nextTime: now + 0.095, lastFrameAtMs: Date.now() };
  }

  // Gentle 2.5ms anti-click ramp at the start of a new speech burst
  if (isNewBurst && samples.length > 32) {
    const fadeSamples = Math.min(24, samples.length);
    for (let i = 0; i < fadeSamples; i++) {
      samples[i] *= i / fadeSamples;
    }
    playIncomingRxChirp({ subtle: true });
  }

  try {
    const audioBuf = ctx.createBuffer(1, samples.length, sampleRate);
    audioBuf.getChannelData(0).set(samples);

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    // Band-limit gently around 3.6kHz for crisp Motorola voice clarity without high-frequency aliasing
    const lpFilter = ctx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.value = 3650;

    const boostGain = ctx.createGain();
    boostGain.gain.value = 1.25;

    src.connect(lpFilter);
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
  try {
    const ctx = getSharedAudioContext();
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
      gain.gain.linearRampToValueAtTime(0.16, now + t.start + 0.006);
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
  try {
    const ctx = getSharedAudioContext();
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const beepGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, now);
    beepGain.gain.setValueAtTime(0.001, now);
    beepGain.gain.linearRampToValueAtTime(0.12, now + 0.008);
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
    noiseGain.gain.setValueAtTime(0.08, now + 0.05);
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
 * نغمة فتح استقبال نداء وارد من زميل على القناة
 */
export function playIncomingRxChirp({ subtle = false } = {}) {
  if (!subtle) triggerHaptic([40]);
  try {
    const ctx = getSharedAudioContext();
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const peak = subtle ? 0.07 : 0.14;
    const notes = [784, 1174.66];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.04);
      gain.gain.setValueAtTime(0.001, now + i * 0.04);
      gain.gain.linearRampToValueAtTime(peak, now + i * 0.04 + 0.007);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.045);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.05);
    });
  } catch {
    // Ignore
  }
}

/**
 * جرس انتباه لاسلكي عاجل (Call-Tone / Emergency Pager Alert)
 */
export function playUrgentPagerTone() {
  triggerHaptic([110, 60, 110, 60, 140]);
  try {
    const ctx = getSharedAudioContext();
    const dest = getOutputDestination(ctx);
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    const pattern = [987.77, 1318.51, 987.77, 1318.51, 1567.98];
    pattern.forEach((freq, idx) => {
      const start = now + idx * 0.095;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.085);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(start);
      osc.stop(start + 0.09);
    });
  } catch {
    // Ignore
  }
}

/**
 * إرسال إشعار نظام عبر Service Worker عند ورود جرس انتباه والتطبيق بالخلفية
 */
export function notifyWalkieBackgroundAlert(title, body) {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'ZAYED_WALKIE_NOTIFY',
        title,
        body,
      });
    }
  } catch {
    // ignore
  }
}

/**
 * تشغيل مقطع نداء لاسلكي مسجل (لإعادة تشغيل السجل أو جرس الطوارئ)
 */
export function playWalkieAudioClip(dataUrl, { onLevel, withRadioEffects = true } = {}) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof Audio === 'undefined') {
      resolve(false);
      return;
    }

    let settled = false;
    let simInterval = null;
    let safetyTimeout = null;
    const audio = new Audio(dataUrl);
    audio.preload = 'auto';

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
      playIncomingRxChirp();
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

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);

    safetyTimeout = setTimeout(() => {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      finish(true);
    }, 36000);

    setTimeout(
      () => {
        if (settled) return;
        audio.play().catch(() => finish(false));
      },
      withRadioEffects ? 85 : 0
    );
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
