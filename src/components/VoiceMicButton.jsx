import React, { useRef, useState } from 'react';
import { isSpeechRecognitionSupported, startArabicVoiceDictation } from '../lib/audio.js';

/**
 * زر المايكروفون الذكي لتحويل الصوت إلى نص بالعربية (Voice-to-Text)
 * يعمل في الملاحظات، استلام العربيات، الحضور، وتسليم الورديات بدون لمس الكيبورد
 */
export default function VoiceMicButton({ onTranscript, onToast, small = false }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  if (!isSpeechRecognitionSupported()) {
    return null;
  }

  function handleToggle() {
    if (listening && recRef.current) {
      recRef.current.stop();
      setListening(false);
      return;
    }

    setListening(true);
    recRef.current = startArabicVoiceDictation({
      onResult: (text) => {
        onTranscript?.(text);
        onToast?.('تم تحويل صوتك إلى نص مكتوب 🎤');
      },
      onError: (errMsg) => {
        onToast?.(errMsg, 'error');
      },
      onEnd: () => {
        setListening(false);
      },
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`inline-flex items-center gap-1.5 rounded-full font-bold transition-all shrink-0 ${
        small ? 'px-3 py-1 text-xs' : 'px-3.5 py-1.5 text-xs sm:text-sm'
      } ${
        listening
          ? 'bg-[#D93025] text-white shadow-sm animate-pulse'
          : 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] hover:opacity-90'
      }`}
      title="تحدث بصوتك ليتحول الكلام لنص مكتوب تلقائياً"
    >
      <span className="ms-icon filled text-base">{listening ? 'graphic_eq' : 'mic'}</span>
      <span>{listening ? 'تحدث الآن... (اضغط للإيقاف)' : 'إملاء صوتي 🎤'}</span>
    </button>
  );
}
