/**
 * مؤثرات صوتية خفيفة للتأكيد + نطق صوتي بالعربية + إملاء صوتي للملاحظات بدون كيبورد
 */

export function playSuccessChime(type = 'in') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes =
      type === 'out'
        ? [587.33, 440] // D5 -> A4
        : type === 'alert'
        ? [523.25, 659.25, 783.99]
        : [523.25, 659.25]; // C5 -> E5 pleasant Google-style chime

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.11 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.25);
    });
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export function speakArabicConfirmation(text, enabled = true) {
  if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ar-EG';
    utter.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const arVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
    if (arVoice) utter.voice = arVoice;
    window.speechSynthesis.speak(utter);
  } catch {
    // Ignore TTS failures
  }
}

export function isSpeechRecognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

export function startArabicVoiceDictation({ onResult, onError, onEnd }) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    onError?.('المتصفح الحالي لا يدعم الإملاء الصوتي (يفضل Google Chrome)');
    return null;
  }

  const recognition = new SpeechRec();
  recognition.lang = 'ar-EG';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || '';
    if (transcript) onResult?.(transcript.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') {
      onError?.('يرجى السماح بالمايكروفون من شريط عنوان المتصفح لاستخدام الإملاء الصوتي');
    } else if (event.error !== 'aborted') {
      onError?.('لم يتم التقاط صوت واضح، حاول مرة أخرى');
    }
  };

  recognition.onend = () => {
    onEnd?.();
  };

  recognition.start();
  return recognition;
}
