import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  deleteMyAvatar,
  fetchMyProfile,
  fetchPersonLog,
  hasPermission,
  isApiConnectedMode,
  updateMyProfile,
  uploadMyAvatar,
} from '../../lib/api.js';
import {
  ACTION_LABELS,
  buildPersonLogWhatsAppText,
  exportPersonLogCsv,
  exportPersonLogWord,
  formatTimeArabic,
  getCctvStatusType,
  openWhatsAppShare,
} from '../../lib/exportUtils.js';
import {
  Button,
  CockpitMetricStrip,
  ConfirmSheet,
  EmptyState,
  GroupedList,
  GroupedRow,
  Icon,
  RoleAvatar,
  SkeletonList,
  StatusDot,
} from '../ui/index.js';
import AvatarCropModal from './AvatarCropModal.jsx';
import AvatarPickerSheet from './AvatarPickerSheet.jsx';

/**
 * Section 1: Role Profile, Photo Actions & Collapsible QR / Personal Log.
 * Accessible to ALL 9 non-kiosk roles.
 */
export default function SettingsProfileSection({
  authUser,
  myProfile,
  permissions = [],
  connectionMode = 'local_server',
  onUserUpdated,
  onNavigateSection,
  onRefresh,
  onToast,
}) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const [profileData, setProfileData] = useState(myProfile || null);
  const [personLog, setPersonLog] = useState(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrExpanded, setQrExpanded] = useState(false);

  const [displayName, setDisplayName] = useState(
    myProfile?.display_name || authUser?.display_name || ''
  );
  const [phone, setPhone] = useState(myProfile?.phone || '');
  const [savingInfo, setSavingInfo] = useState(false);

  const [cropFile, setCropFile] = useState(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const role = authUser?.role || '';
  const canEditSelf = hasPermission(permissions, role, 'profile:edit_self');
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const isOnlineApi = isApiConnectedMode(connectionMode);

  useEffect(() => {
    if (myProfile) {
      setProfileData((prev) => ({ ...(prev || {}), ...myProfile }));
      if (myProfile.display_name) setDisplayName(myProfile.display_name);
      if (myProfile.phone !== undefined) setPhone(myProfile.phone || '');
    }
  }, [myProfile]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileAndLogs() {
      setLoadingLog(true);
      try {
        const res = await fetchMyProfile();
        if (cancelled) return;
        if (res?.profile) {
          setProfileData(res.profile);
          setDisplayName(res.profile.display_name || authUser?.display_name || '');
          setPhone(res.profile.phone || res.profile.employee?.phone || '');
        }
        const empId =
          res?.profile?.employee_id ||
          res?.profile?.employee?.id ||
          myProfile?.employee_id ||
          authUser?.employee_id ||
          authUser?.id;

        if (empId) {
          try {
            const url = await QRCode.toDataURL(`ZMART:EMP:${empId}`, {
              width: 240,
              margin: 1,
            });
            if (!cancelled) setQrDataUrl(url);
          } catch {
            // ignore QR generation failure
          }
          try {
            const logRes = await fetchPersonLog(empId);
            if (!cancelled) setPersonLog(logRes);
          } catch {
            // ignore log error if offline
          }
        }
      } catch {
        const fallbackEmpId =
          myProfile?.employee_id || authUser?.employee_id || authUser?.id;
        if (fallbackEmpId && !cancelled) {
          QRCode.toDataURL(`ZMART:EMP:${fallbackEmpId}`, { width: 240, margin: 1 })
            .then((url) => {
              if (!cancelled) setQrDataUrl(url);
            })
            .catch(() => {});
        }
      } finally {
        if (!cancelled) setLoadingLog(false);
      }
    }

    loadProfileAndLogs();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, authUser?.employee_id, authUser?.display_name, myProfile?.employee_id]);

  const p = profileData || myProfile || authUser || {};
  const emp = p.employee || {};
  const effectiveAvatar =
    p.effective_avatar_url ?? p.avatar_url ?? authUser?.avatar_url ?? '';
  const ownAvatar = p.own_avatar_url ?? p.avatar_url ?? authUser?.avatar_url ?? '';
  const avatarPreset = p.avatar_preset || authUser?.avatar_preset || 'role_default';
  const avatarColor = p.avatar_color || authUser?.avatar_color || '';
  const username = p.username || authUser?.username || '';
  const shiftStart = emp.shift_start || p.shift_start || '08:00';
  const shiftEnd = emp.shift_end || p.shift_end || '20:00';

  function handleSelectImageFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCropFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (!canEditSelf || !isOnlineApi) return;
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type?.startsWith('image/')) {
      setCropFile(file);
    }
  }

  async function handleConfirmCrop({ dataUrl, applyToRoleDefault }) {
    setSavingPhoto(true);
    try {
      const res = await uploadMyAvatar(dataUrl, { applyToRoleDefault });
      setCropFile(null);
      if (res?.user) {
        setProfileData((prev) => ({
          ...(prev || {}),
          ...res.user,
          effective_avatar_url: res.user.effective_avatar_url ?? res.user.avatar_url ?? '',
          own_avatar_url: res.user.own_avatar_url ?? '',
        }));
        onUserUpdated?.(res.user);
      }
      onToast?.(
        applyToRoleDefault
          ? 'تم حفظ الصورة وتعيينها افتراضياً للدور'
          : 'تم تحديث الصورة'
      );
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر رفع الصورة', 'error');
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleSavePresetAndColor({ avatar_preset, avatar_color, clear_photo }) {
    setSavingPhoto(true);
    try {
      const res = await updateMyProfile({
        avatar_preset,
        avatar_color,
        clear_photo,
      });
      setPickerOpen(false);
      if (res?.user) {
        setProfileData((prev) => ({
          ...(prev || {}),
          ...res.user,
          effective_avatar_url: res.user.effective_avatar_url ?? res.user.avatar_url ?? '',
          own_avatar_url: res.user.own_avatar_url ?? '',
        }));
        onUserUpdated?.(res.user);
      }
      onToast?.('تم تحديث الأفاتار');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ الأفاتار', 'error');
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleConfirmRemovePhoto() {
    setSavingPhoto(true);
    try {
      const res = await deleteMyAvatar();
      setConfirmRemoveOpen(false);
      if (res?.user) {
        setProfileData((prev) => ({
          ...(prev || {}),
          ...res.user,
          effective_avatar_url: res.user.effective_avatar_url ?? res.user.avatar_url ?? '',
          own_avatar_url: res.user.own_avatar_url ?? '',
        }));
        onUserUpdated?.(res.user);
      }
      onToast?.('تم حذف الصورة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حذف الصورة', 'error');
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleSaveBasicInfo(e) {
    e.preventDefault();
    if (!canEditSelf || !isOnlineApi || savingInfo) return;
    const cleanName = displayName.trim();
    if (cleanName.length < 2) {
      onToast?.('يرجى كتابة الاسم (حرفان على الأقل)', 'error');
      return;
    }
    setSavingInfo(true);
    try {
      const res = await updateMyProfile({
        display_name: cleanName,
        phone: phone.trim(),
      });
      if (res?.user) {
        setProfileData((prev) => ({
          ...(prev || {}),
          ...res.user,
          phone: phone.trim(),
        }));
        onUserUpdated?.(res.user);
      }
      onToast?.('تم حفظ البيانات');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ البيانات', 'error');
    } finally {
      setSavingInfo(false);
    }
  }

  const plAtt = personLog?.attendanceLogs || profileData?.myAttendanceLogs || [];
  const plStats = {
    totalCheckIns:
      personLog?.stats?.totalCheckIns ??
      personLog?.summary?.daysPresent ??
      plAtt.filter((a) => a.action_type === 'check_in').length,
    totalBreaks:
      personLog?.stats?.totalBreaks ??
      personLog?.summary?.totalBreakCount ??
      plAtt.filter((a) => a.action_type === 'break_start').length,
    totalBreakMinutes:
      personLog?.stats?.totalBreakMinutes ??
      personLog?.summary?.totalBreakMinutes ??
      plAtt
        .filter((a) => a.action_type === 'break_end')
        .reduce((acc, a) => acc + (Number(a.break_duration_minutes) || 0), 0),
    shortagesReported:
      personLog?.stats?.shortagesReported ??
      personLog?.summary?.shortagesCount ??
      (personLog?.shortages || []).length,
    notesRecorded:
      personLog?.stats?.notesRecorded ??
      personLog?.summary?.notesCount ??
      (personLog?.notes || []).length,
  };

  return (
    <div className="space-y-6">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleSelectImageFile}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleSelectImageFile}
        className="hidden"
      />

      {!isOnlineApi && (
        <div className="px-1">
          <StatusDot tone="warning" tintedText label="وضع أوفلاين — يتطلب الاتصال للتعديل" />
        </div>
      )}

      {/* 1. Clean Identity & Photo Actions */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (canEditSelf && isOnlineApi) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`space-y-4 transition-colors ${
          dragActive ? 'ring-2 ring-[var(--g-primary)] rounded-[var(--g-radius-card)] p-2' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <RoleAvatar
              src={effectiveAvatar}
              name={p.display_name || authUser?.display_name}
              role={role}
              color={avatarColor}
              preset={avatarPreset}
              size="xl"
              editable={canEditSelf && isOnlineApi}
              onClick={
                canEditSelf && isOnlineApi
                  ? () => galleryInputRef.current?.click()
                  : undefined
              }
            />

            <div className="min-w-0 space-y-0.5">
              <div className="text-base sm:text-lg font-semibold text-ink truncate">
                {p.display_name || authUser?.display_name}
              </div>
              <div className="text-xs text-ink-muted flex items-center gap-1.5 flex-wrap">
                <span>{p.role_label || authUser?.role_label || role}</span>
                {username && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="num-ltr">@{username}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {canManageUsers && onNavigateSection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateSection('roles')}
            >
              صور الأدوار
            </Button>
          )}
        </div>

        {canEditSelf && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="photo_camera"
              disabled={!isOnlineApi || savingPhoto}
              onClick={() => cameraInputRef.current?.click()}
            >
              كاميرا
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="image"
              disabled={!isOnlineApi || savingPhoto}
              onClick={() => galleryInputRef.current?.click()}
            >
              معرض
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="palette"
              disabled={!isOnlineApi || savingPhoto}
              onClick={() => setPickerOpen(true)}
            >
              أفاتار
            </Button>
            {ownAvatar && (
              <Button
                variant="dangerTonal"
                size="sm"
                icon="delete"
                disabled={!isOnlineApi || savingPhoto}
                onClick={() => setConfirmRemoveOpen(true)}
              >
                حذف
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 2. Basic Info Grouped Form */}
      <form onSubmit={handleSaveBasicInfo} className="space-y-3">
        <GroupedList label="البيانات">
          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label
              htmlFor="profile-display-name"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-28 shrink-0"
            >
              الاسم
            </label>
            <input
              id="profile-display-name"
              type="text"
              required
              disabled={!canEditSelf || !isOnlineApi}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="الاسم"
              className="g-input flex-1 min-w-0"
            />
          </div>

          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label
              htmlFor="profile-phone"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-28 shrink-0"
            >
              الهاتف
            </label>
            <input
              id="profile-phone"
              type="tel"
              dir="ltr"
              disabled={!canEditSelf || !isOnlineApi || !p.employee_id}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={p.employee_id ? '010xxxxxxxx' : '—'}
              className="g-input num-ltr flex-1 min-w-0 placeholder:text-right"
            />
          </div>

          <GroupedRow>
            <span className="text-xs sm:text-sm font-medium text-ink-muted">الدور</span>
            <span className="text-xs sm:text-sm font-medium text-ink truncate">
              {p.role_label || authUser?.role_label || role}
            </span>
          </GroupedRow>

          <GroupedRow>
            <span className="text-xs sm:text-sm font-medium text-ink-muted">القسم</span>
            <span className="text-xs sm:text-sm font-medium text-ink truncate">
              {emp.department || p.department || p.role_label || '—'}
            </span>
          </GroupedRow>

          <GroupedRow>
            <span className="text-xs sm:text-sm font-medium text-ink-muted">الشفت</span>
            <span className="text-xs sm:text-sm font-medium text-ink num-ltr">
              {shiftStart} – {shiftEnd}
            </span>
          </GroupedRow>
        </GroupedList>

        {canEditSelf && (
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingInfo}
              disabled={!isOnlineApi}
            >
              حفظ
            </Button>
          </div>
        )}
      </form>

      {/* 3. Collapsible QR Card & Personal Log */}
      <GroupedList>
        <GroupedRow
          onClick={() => setQrExpanded((v) => !v)}
          aria-expanded={qrExpanded}
        >
          <span className="flex items-center gap-2 text-xs sm:text-sm font-medium text-ink">
            <Icon name="qr_code_2" size={18} className="text-ink-muted" />
            <span>بطاقة QR وسجلي</span>
          </span>
          <Icon
            name={qrExpanded ? 'expand_less' : 'expand_more'}
            size={18}
            className="text-ink-muted"
          />
        </GroupedRow>

        {qrExpanded && (
          <div className="p-3.5 sm:p-4 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="بطاقة QR"
                  className="w-36 h-36 rounded-xl bg-white p-2 border border-line shrink-0"
                />
              ) : (
                <div className="w-36 h-36 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-xs font-medium text-ink-muted shrink-0">
                  QR
                </div>
              )}

              <div className="w-full flex-1 space-y-3 min-w-0">
                <CockpitMetricStrip
                  columns={4}
                  items={[
                    {
                      id: 'att',
                      label: 'الحضور',
                      value: plStats.totalCheckIns,
                      tone: 'success',
                    },
                    {
                      id: 'breaks',
                      label: 'الاستراحات',
                      value: plStats.totalBreaks,
                      secondary:
                        plStats.totalBreakMinutes > 0
                          ? `${plStats.totalBreakMinutes} د`
                          : '',
                      tone: 'warning',
                    },
                    {
                      id: 'shortages',
                      label: 'النواقص',
                      value: plStats.shortagesReported,
                      tone: 'primary',
                    },
                    {
                      id: 'notes',
                      label: 'الملاحظات',
                      value: plStats.notesRecorded,
                      tone: 'purple',
                    },
                  ]}
                />

                {personLog && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="table_view"
                      onClick={async () => {
                        try {
                          await exportPersonLogCsv(personLog);
                          onToast?.('تم تصدير Excel');
                        } catch (err) {
                          onToast?.(err.message || 'تعذر التصدير', 'error');
                        }
                      }}
                    >
                      Excel
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="description"
                      onClick={() => {
                        exportPersonLogWord(personLog);
                        onToast?.('تم تصدير Word');
                      }}
                    >
                      Word
                    </Button>
                    <Button
                      variant="whatsapp"
                      size="sm"
                      icon="share"
                      onClick={() =>
                        openWhatsAppShare(buildPersonLogWhatsAppText(personLog))
                      }
                    >
                      واتساب
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {loadingLog && plAtt.length === 0 ? (
              <SkeletonList count={3} />
            ) : plAtt.length === 0 ? (
              <EmptyState compact icon="history" title="لا توجد حركات مسجلة" />
            ) : (
              <div className="border-t border-line divide-y divide-line">
                {plAtt.slice(0, 10).map((a) => {
                  const cctvType = getCctvStatusType(a);
                  const cctvTone =
                    cctvType === 'confirmed'
                      ? 'success'
                      : cctvType === 'mismatch'
                      ? 'danger'
                      : 'warning';
                  const cctvLabel =
                    cctvType === 'mismatch'
                      ? 'تعارض'
                      : cctvType === 'pending'
                      ? 'مراجعة'
                      : '';
                  return (
                    <div
                      key={a.id}
                      className="py-2.5 flex items-center justify-between gap-2 text-xs min-w-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusDot
                          tone={cctvTone}
                          label={ACTION_LABELS[a.action_type] || a.action_type}
                          tintedText={false}
                        />
                        {a.break_duration_minutes > 0 && (
                          <span className="text-ink-muted num-ltr">
                            {a.break_duration_minutes} د
                          </span>
                        )}
                        {cctvLabel && (
                          <span
                            className={`text-[11px] font-medium ${
                              cctvType === 'mismatch' ? 'text-danger' : 'text-warning'
                            }`}
                          >
                            · {cctvLabel}
                          </span>
                        )}
                      </div>
                      <span className="text-ink-muted num-ltr shrink-0">
                        {a.date_key} · {formatTimeArabic(a.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </GroupedList>

      <AvatarCropModal
        open={Boolean(cropFile)}
        onClose={() => setCropFile(null)}
        imageFileOrSrc={cropFile}
        targetLabel={p.display_name || authUser?.display_name}
        roleLabel={p.role_label || authUser?.role_label}
        canSetRoleDefault={canManageUsers}
        saving={savingPhoto}
        onConfirmCrop={handleConfirmCrop}
      />

      <AvatarPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        userName={p.display_name || authUser?.display_name}
        userRole={role}
        currentPreset={avatarPreset}
        currentColor={avatarColor}
        hasCustomPhoto={Boolean(ownAvatar)}
        saving={savingPhoto}
        onSavePresetAndColor={handleSavePresetAndColor}
        onTriggerCamera={() => cameraInputRef.current?.click()}
        onTriggerGallery={() => galleryInputRef.current?.click()}
        onRequestRemovePhoto={() => setConfirmRemoveOpen(true)}
      />

      <ConfirmSheet
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={handleConfirmRemovePhoto}
        loading={savingPhoto}
        tone="danger"
        title="حذف الصورة"
        description="إزالة الصورة المخصصة واستعادة رمز الدور الافتراضي؟"
        confirmLabel="حذف"
      />
    </div>
  );
}
