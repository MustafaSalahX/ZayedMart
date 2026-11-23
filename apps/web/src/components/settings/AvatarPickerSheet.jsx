import React, { useEffect, useState } from 'react';
import { AVATAR_COLORS, AVATAR_PRESETS } from '../../lib/avatarPresets.js';
import { BottomSheet, Button, Icon, RoleAvatar } from '../ui/index.js';

/**
 * Curated Role Avatar Preset & High-Contrast Color Picker Sheet.
 * 12 presets + 10 colors, plus Camera / Gallery / Remove custom photo actions.
 */
export default function AvatarPickerSheet({
  open,
  onClose,
  userName = '',
  userRole = '',
  currentPreset = 'role_default',
  currentColor = '',
  hasCustomPhoto = false,
  saving = false,
  onSavePresetAndColor,
  onTriggerCamera,
  onTriggerGallery,
  onRequestRemovePhoto,
}) {
  const [selectedPreset, setSelectedPreset] = useState(currentPreset || 'role_default');
  const [selectedColor, setSelectedColor] = useState(
    currentColor || AVATAR_COLORS[0]?.hex || ''
  );

  useEffect(() => {
    if (!open) return;
    setSelectedPreset(currentPreset || 'role_default');
    setSelectedColor(currentColor || AVATAR_COLORS[0]?.hex || '');
  }, [open, currentPreset, currentColor]);

  async function handleSave() {
    if (saving) return;
    await onSavePresetAndColor?.({
      avatar_preset: selectedPreset,
      avatar_color: selectedColor,
      clear_photo: true,
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={saving ? undefined : onClose}
      title="اختيار الأفاتار"
      maxWidth="max-w-lg"
      closeOnOverlay={!saving}
      footer={
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            fullWidth
            disabled={saving}
            onClick={onClose}
          >
            إلغاء
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={saving}
            onClick={handleSave}
          >
            تطبيق
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {/* Live Preview Header */}
        <div className="pb-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <RoleAvatar
              src=""
              name={userName}
              role={userRole}
              color={selectedColor}
              preset={selectedPreset}
              size="lg"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">
                {userName || 'الأفاتار'}
              </div>
              <div className="text-xs text-ink-muted">
                {AVATAR_PRESETS.find((p) => p.id === selectedPreset)?.label || ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {onTriggerCamera && (
              <Button
                variant="secondary"
                size="sm"
                icon="photo_camera"
                onClick={() => {
                  onClose?.();
                  onTriggerCamera();
                }}
              >
                كاميرا
              </Button>
            )}
            {onTriggerGallery && (
              <Button
                variant="secondary"
                size="sm"
                icon="image"
                onClick={() => {
                  onClose?.();
                  onTriggerGallery();
                }}
              >
                معرض
              </Button>
            )}
          </div>
        </div>

        {/* 12 Presets Grid */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-ink-muted">الرمز</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {AVATAR_PRESETS.map((preset) => {
              const active = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`min-h-[82px] p-2.5 rounded-[var(--g-radius-md)] border flex flex-col items-center justify-center gap-1.5 text-center transition-[border-color,background-color] duration-150 cursor-pointer active:scale-95 ${
                    active
                      ? 'border-primary bg-surface-tint text-ink font-semibold'
                      : 'border-line bg-surface hover:border-line-strong text-ink-muted font-medium'
                  }`}
                >
                  <RoleAvatar
                    src=""
                    name={userName}
                    role={userRole}
                    color={selectedColor}
                    preset={preset.id}
                    size="sm"
                  />
                  <span className="text-[11px] leading-tight line-clamp-1">
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 10 Colors Grid */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-ink-muted">اللون</div>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
            {AVATAR_COLORS.map((c) => {
              const active =
                String(selectedColor || '').toUpperCase() === c.hex.toUpperCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={active}
                  onClick={() => setSelectedColor(c.hex)}
                  style={{ backgroundColor: c.hex }}
                  className={`min-h-[44px] w-full rounded-[var(--g-radius-md)] text-white flex items-center justify-center transition-transform active:scale-95 cursor-pointer ${
                    active
                      ? 'ring-2 ring-offset-2 ring-[var(--g-primary-solid)] scale-105'
                      : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  {active && (
                    <Icon name="check" size={16} weight="bold" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {hasCustomPhoto && onRequestRemovePhoto && (
          <div className="pt-2 border-t border-line">
            <Button
              variant="dangerTonal"
              fullWidth
              size="sm"
              icon="delete"
              onClick={() => {
                onClose?.();
                onRequestRemovePhoto();
              }}
            >
              حذف الصورة المخصصة
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
