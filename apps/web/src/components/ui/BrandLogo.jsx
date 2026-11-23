import React, { useState } from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

const SIZE_CLASSES = {
  xs: 'w-6 h-6 rounded-md',
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-9 h-9 rounded-lg',
  lg: 'w-11 h-11 rounded-xl',
  xl: 'w-14 h-14 rounded-2xl',
};

/**
 * Adaptive ZayedMart store logo mark with `/Logo.png` -> `/logo.jpeg` fallback.
 * Removes heavy bordered box framing in Minimalism / Liquid Glass / Elegant (`showLogoBox === false`).
 */
export default function BrandLogo({
  alt = 'زايد مارت',
  size = 'md',
  bare = undefined,
  className = '',
}) {
  const arch = useThemeArchitecture();
  const [src, setSrc] = useState('/Logo.png');
  const [failed, setFailed] = useState(false);

  const sz = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const isBare = bare !== undefined ? bare : !arch.shell.showLogoBox;
  const frameCls = isBare
    ? ''
    : 'border border-line bg-surface';

  if (failed) {
    return (
      <span
        aria-label={alt}
        className={`${sz} bg-primary-solid text-on-primary shrink-0 inline-flex items-center justify-center ${
          isBare ? '' : 'border border-line'
        } ${className}`}
      >
        <Icon name="storefront" size={16} filled />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => {
        if (src === '/Logo.png') {
          setSrc('/logo.jpeg');
        } else {
          setFailed(true);
        }
      }}
      className={`${sz} object-cover shrink-0 ${frameCls} ${className}`}
    />
  );
}
