import React, { memo } from 'react';
import { useTheme } from '../lib/themeContext.jsx';

/**
 * Living GPU-Composited Optical Backdrop (<AmbientBackdrop />):
 * - Liquid Glass: 4 spatially separated 5-stop radial-gradient light orbs drifting via translate3d
 *   (zero full-screen filter:blur() so Android WebViews & Safari stay 60fps).
 * - Elegant / Modern: Static subtle atmospheric wash.
 * - Minimal / Classic / Lite Mode / Glass Off / Kiosk: Returns `null` (0 DOM nodes, 0 GPU cost).
 */
const AmbientBackdrop = memo(function AmbientBackdrop() {
  const { architecture, liteMode, glassMode, isKioskLocked } = useTheme();
  const variant = architecture?.backdrop?.variant || 'none';

  if (isKioskLocked || liteMode || glassMode === 'off' || variant === 'none') {
    return null;
  }

  return (
    <div
      data-ambient-backdrop={variant}
      aria-hidden="true"
      className="g-ambient-backdrop"
    >
      {variant === 'liquid-glass' && (
        <>
          <div className="g-ambient-orb g-ambient-orb--1" />
          <div className="g-ambient-orb g-ambient-orb--2" />
          <div className="g-ambient-orb g-ambient-orb--3" />
          <div className="g-ambient-orb g-ambient-orb--4" />
        </>
      )}
    </div>
  );
});

export default AmbientBackdrop;
