import React from 'react';
import VoiceMicButton from '../VoiceMicButton.jsx';
import Icon from './Icon.jsx';

/**
 * Unified mobile-friendly search input bar with >=40px clear target, >=16px mobile input font
 * (prevents iOS auto-zoom), and optional Arabic voice dictation.
 */
export default function SearchFilterBar({
  value,
  onChange,
  placeholder = 'بحث...',
  voice = false,
  onVoiceTranscript,
  onToast,
  rightSlot = null,
  className = '',
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <div className="g-search-bar flex-1 flex items-center gap-1.5 ps-3.5 pe-1.5 min-h-[44px]">
        <Icon name="search" size={18} className="text-ink-muted" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full min-w-0 bg-transparent border-none outline-none text-base sm:text-sm text-ink placeholder:text-ink-muted py-1.5"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange?.('')}
            aria-label="مسح البحث"
            className="w-10 h-10 rounded-full hover:bg-surface text-ink-muted hover:text-ink flex items-center justify-center shrink-0 transition-colors active:scale-95"
          >
            <Icon name="close" size={16} />
          </button>
        )}
        {voice && (
          <VoiceMicButton
            small
            onToast={onToast}
            onTranscript={(text) => {
              if (onVoiceTranscript) {
                onVoiceTranscript(text);
              } else {
                onChange?.(text);
              }
            }}
          />
        )}
      </div>
      {rightSlot}
    </div>
  );
}
