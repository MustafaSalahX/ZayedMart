import React from 'react';
import VoiceMicButton from '../VoiceMicButton.jsx';

/**
 * Unified mobile-friendly search input bar with clear button and optional Arabic voice dictation.
 */
export default function SearchFilterBar({
  value,
  onChange,
  placeholder = 'بحث...',
  voice = false,
  onVoiceTranscript,
  rightSlot = null,
  className = '',
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <div className="g-search-bar flex-1 flex items-center gap-2 px-3.5 min-h-[44px]">
        <span className="ms-icon text-lg text-[var(--g-muted)] shrink-0">search</span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="w-full min-w-0 bg-transparent border-none outline-none text-sm sm:text-base text-[var(--g-text)] placeholder:text-[var(--g-muted)]"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange?.('')}
            aria-label="مسح البحث"
            className="w-7 h-7 rounded-full bg-[var(--g-surface)] text-[var(--g-muted)] hover:text-[var(--g-text)] flex items-center justify-center shrink-0"
          >
            <span className="ms-icon text-base">close</span>
          </button>
        )}
        {voice && (
          <VoiceMicButton
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
