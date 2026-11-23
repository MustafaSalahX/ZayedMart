import React, { useRef, useState } from 'react';
import { isSpeechRecognitionSupported, startArabicVoiceDictation } from '../lib/audio.js';
import Icon from './ui/Icon.jsx';

/**
 * Arabic Voice-to-Text dictation trigger (`VoiceMicButton`).
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
        onToast?.('تم النسخ الصوتي');
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
      aria-pressed={listening}
      aria-label={listening ? 'إيقاف الإملاء الصوتي' : 'إملاء صوتي'}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-[var(--g-radius-btn)] font-semibold transition-[transform,background-color,color,opacity] duration-150 ease-[var(--g-ease-out)] shrink-0 active:scale-[0.97] ${
        small ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-xs sm:text-sm'
      } ${
        listening
          ? 'bg-danger-solid text-on-danger animate-pulse'
          : 'bg-surface-2 text-ink border border-line hover:border-line-strong'
      }`}
    >
      <Icon name={listening ? 'graphic_eq' : 'mic'} size={16} filled />
      <span>{listening ? 'إيقاف' : small ? 'صوتي' : 'إملاء صوتي'}</span>
    </button>
  );
}
