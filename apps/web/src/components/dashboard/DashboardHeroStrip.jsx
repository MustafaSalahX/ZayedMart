import React from 'react';
import { Button, Icon, RoleAvatar } from '../ui/index.js';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';

/**
 * Pure Apple / Linear Borderless Typographic Page Header for AdminDashboard.
 * Sits directly on canvas — zero outer card box, zero greeting fluff, zero badge spam.
 */
export default function DashboardHeroStrip({
  data,
  authUser,
  canExportReports = false,
  canHandover = false,
  canPrintCards = false,
  onOpenExportSheet,
  onOpenHandoverModal,
  onOpenQrModal,
  onOpenSettings,
}) {
  const arch = useThemeArchitecture();

  const role = authUser?.role || '';
  const displayName = authUser?.display_name || 'المدير';
  const avatarSrc =
    authUser?.effective_avatar_url ||
    authUser?.avatar_url ||
    data?.myProfile?.avatar_url ||
    '';
  const avatarColor = authUser?.avatar_color || data?.myProfile?.avatar_color || '';
  const avatarPreset = authUser?.avatar_preset || data?.myProfile?.avatar_preset || 'role_default';
  const dateKey = data?.dateKey || '';

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 py-1 min-w-0">
      <div className="flex items-center gap-3 min-w-0">
        <RoleAvatar
          src={avatarSrc}
          name={displayName}
          role={role}
          color={avatarColor}
          preset={avatarPreset}
          size="sm"
          shape="circle"
          onClick={onOpenSettings ? () => onOpenSettings('profile') : undefined}
          ariaLabel="الملف الشخصي"
        />

        <div className="flex items-baseline gap-2.5 flex-wrap min-w-0">
          <h1
            className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0 leading-tight truncate`}
          >
            {displayName}
          </h1>
          {dateKey && (
            <span className="num-ltr text-xs font-medium text-ink-muted shrink-0">
              {dateKey}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {canExportReports && onOpenExportSheet && (
          <Button
            variant="secondary"
            size="sm"
            icon="ios_share"
            onClick={onOpenExportSheet}
          >
            تصدير
          </Button>
        )}

        {canHandover && onOpenHandoverModal && (
          <Button
            variant="ghost"
            size="sm"
            icon="swap_horiz"
            onClick={onOpenHandoverModal}
            className="hidden sm:inline-flex"
          >
            الوردية
          </Button>
        )}

        {canPrintCards && onOpenQrModal && (
          <Button
            variant="ghost"
            size="sm"
            icon="qr_code_2"
            onClick={() => onOpenQrModal('cards')}
            className="hidden sm:inline-flex"
          >
            QR
          </Button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            onClick={() => onOpenSettings('system')}
            aria-label="الإعدادات"
            title="الإعدادات"
            className={`w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center shrink-0 transition-[background-color,color,transform] duration-150 ease-[var(--g-ease-out)] cursor-pointer ${arch.motion.pressClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]`}
          >
            <Icon name="settings" size={20} />
          </button>
        )}
      </div>
    </header>
  );
}
