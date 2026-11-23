import React from 'react';

const DOT_TONES = {
  neutral: 'bg-ink-muted',
  primary: 'bg-primary-solid',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
  purple: 'bg-purple-solid',
};

const TEXT_TONES = {
  neutral: 'text-ink-muted',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  purple: 'text-purple',
};

/**
 * Quiet 8px semantic status dot + concise 1–2 word label (zero pill box noise).
 */
export default function StatusDot({
  tone = 'neutral',
  label = '',
  pulse = false,
  tintedText = false,
  className = '',
  children,
}) {
  const dotCls = DOT_TONES[tone] || DOT_TONES.neutral;
  const textCls = tintedText ? TEXT_TONES[tone] || 'text-ink' : 'text-ink-muted';
  const content = label || children;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium leading-none shrink-0 ${textCls} ${className}`}
    >
      <span className="relative inline-flex w-2 h-2 shrink-0" aria-hidden="true">
        {pulse && (
          <span
            className={`absolute inset-0 rounded-full opacity-60 animate-ping ${dotCls}`}
          />
        )}
        <span className={`relative w-2 h-2 rounded-full ${dotCls}`} />
      </span>
      {content && <span>{content}</span>}
    </span>
  );
}
