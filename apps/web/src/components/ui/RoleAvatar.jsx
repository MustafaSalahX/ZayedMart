import React, { useEffect, useState } from 'react';
import { ROLE_DEFAULT_COLORS, ROLE_ICONS } from '../../lib/navigation.js';
import Icon from './Icon.jsx';

const PRESET_ICON_MAP = {
  badge_crown: 'workspace_premium',
  badge_shield: 'shield_person',
  badge_cashier: 'point_of_sale',
  badge_camera: 'videocam',
  badge_store: 'storefront',
  badge_warehouse: 'warehouse',
  badge_delivery: 'two_wheeler',
  badge_star: 'stars',
  badge_bolt: 'bolt',
};

const SIZE_CLASSES = {
  xs: { box: 'w-7 h-7', iconPx: 14, text: 'text-[11px]', dot: 'w-2 h-2', edit: 'w-4 h-4', editIconPx: 10 },
  sm: { box: 'w-9 h-9', iconPx: 16, text: 'text-xs', dot: 'w-2.5 h-2.5', edit: 'w-5 h-5', editIconPx: 11 },
  md: { box: 'w-11 h-11', iconPx: 20, text: 'text-sm', dot: 'w-3 h-3', edit: 'w-6 h-6', editIconPx: 12 },
  lg: { box: 'w-14 h-14', iconPx: 24, text: 'text-base', dot: 'w-3.5 h-3.5', edit: 'w-7 h-7', editIconPx: 14 },
  xl: { box: 'w-20 h-20', iconPx: 34, text: 'text-xl', dot: 'w-4 h-4', edit: 'w-8 h-8', editIconPx: 15 },
};

const SHAPE_CLASSES = {
  circle: 'rounded-full',
  rounded: 'rounded-[var(--g-radius-md)]',
  squircle: 'rounded-2xl',
};

function getInitials(name = '') {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '؟';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Unified Role & Employee Avatar displaying custom uploaded photo (`src`),
 * curated icon/initials presets, or role icon fallback with broken-image resilience.
 */
export function RoleAvatar({
  src = '',
  name = '',
  role = '',
  color = '',
  preset = 'role_default',
  size = 'md',
  shape = 'circle',
  online = false,
  editable = false,
  className = '',
  onClick,
  ariaLabel = '',
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const sz = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const shapeCls = SHAPE_CLASSES[shape] || SHAPE_CLASSES.circle;
  const rawColor = (typeof color === 'string' && color.trim()) || ROLE_DEFAULT_COLORS[role] || '';
  const usesPrimarySolidFallback =
    !rawColor || rawColor === 'var(--g-primary-solid)' || rawColor === 'var(--g-primary)';
  const bgColor = usesPrimarySolidFallback ? 'var(--g-primary-solid)' : rawColor;
  const showImage = Boolean(src && typeof src === 'string' && src.trim() && !imgFailed);

  const isInitialsGradient = preset === 'initials_gradient';
  const isInitialsMinimal = preset === 'initials_minimal';
  const iconName = PRESET_ICON_MAP[preset] || ROLE_ICONS[role] || 'person';
  const initials = getInitials(name);

  const plateStyle = showImage
    ? undefined
    : isInitialsGradient
    ? {
        backgroundImage: usesPrimarySolidFallback
          ? 'linear-gradient(135deg, var(--g-primary-solid) 0%, var(--g-primary-solid-hover) 100%)'
          : `linear-gradient(135deg, ${bgColor} 0%, var(--g-radio-surface-2) 100%)`,
      }
    : isInitialsMinimal
    ? undefined
    : { backgroundColor: bgColor };

  const plateToneClass = showImage
    ? 'bg-surface-2'
    : isInitialsMinimal
    ? 'bg-primary-container text-on-primary-container border border-line'
    : usesPrimarySolidFallback
    ? 'text-on-primary'
    : 'text-white';

  const content = (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        style={plateStyle}
        className={`${sz.box} ${shapeCls} ${plateToneClass} overflow-hidden flex items-center justify-center font-black select-none border border-line/60 shadow-2xs`}
      >
        {showImage ? (
          <img
            src={src}
            alt={name || 'صورة الحساب'}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : isInitialsGradient || isInitialsMinimal ? (
          <span className={`${sz.text} leading-none tracking-tight`}>{initials}</span>
        ) : (
          <Icon name={iconName} size={sz.iconPx} duotone />
        )}
      </span>

      {online && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -end-0.5 ${sz.dot} rounded-full bg-success-solid ring-2 ring-[var(--g-surface)]`}
        />
      )}

      {editable && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-1 -start-1 ${sz.edit} rounded-full bg-primary-solid text-on-primary ring-2 ring-[var(--g-surface)] flex items-center justify-center shadow-xs`}
        >
          <Icon name="photo_camera" size={sz.editIconPx} filled />
        </span>
      )}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || (name ? `تعديل صورة ${name}` : 'صورة الحساب')}
        className="inline-flex items-center justify-center rounded-full p-0 border-0 bg-transparent cursor-pointer transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]"
      >
        {content}
      </button>
    );
  }

  return content;
}

export const Avatar = RoleAvatar;
export default RoleAvatar;
