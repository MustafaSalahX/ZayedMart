import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES_METADATA } from '@zayed-mart/shared';
import {
  apiRequest,
  checkUsernameAvailable,
  deleteAccountAvatar,
  deleteRoleDefaultAvatar,
  fetchSettingsRoleAccounts,
  isApiConnectedMode,
  normalizeDigitsClient,
  updateAccountCredentials,
  uploadAccountAvatar,
  uploadRoleDefaultAvatar,
} from '../../lib/api.js';
import { AVATAR_COLORS } from '../../lib/avatarPresets.js';
import {
  BottomSheet,
  Button,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  Icon,
  RoleAvatar,
  SearchFilterBar,
  SectionHeader,
  SkeletonList,
  StatusDot,
  ToggleSwitch,
} from '../ui/index.js';
import AvatarCropModal from './AvatarCropModal.jsx';

async function copyTextSafe(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/**
 * Section 4: Admin Role Photos & Accounts Directory (Requires `users:manage`).
 */
export default function SettingsRoleAccountsSection({
  authUser,
  connectionMode = 'local_server',
  onUserUpdated,
  onOpenPersonLog,
  onJumpToRbacMatrix,
  onRefresh,
  onToast,
}) {
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [roleFilter, setRoleFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [revealedPassIds, setRevealedPassIds] = useState({});

  const [photoTarget, setPhotoTarget] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState(null);

  // Edit Account Sheet
  const [editingAcc, setEditingAcc] = useState(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editRole, setEditRole] = useState('cashier');
  const [editColor, setEditColor] = useState(AVATAR_COLORS[0].hex);
  const [editActive, setEditActive] = useState(true);
  const [editAvail, setEditAvail] = useState({ status: 'idle', reason: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Create Account Sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('cashier');
  const [newColor] = useState(AVATAR_COLORS[0].hex);
  const [savingCreate, setSavingCreate] = useState(false);

  const isOnlineApi = isApiConnectedMode(connectionMode);
  const isOwner = authUser?.role === 'owner';

  const loadDirectory = useCallback(async () => {
    if (!isOnlineApi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchSettingsRoleAccounts();
      setRoles(Array.isArray(res?.roles) ? res.roles : []);
      setAccounts(Array.isArray(res?.accounts) ? res.accounts : []);
    } catch (err) {
      onToast?.(err.message || 'تعذر تحميل البيانات', 'error');
    } finally {
      setLoading(false);
    }
  }, [isOnlineApi, onToast]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    if (!editingAcc) return undefined;
    const clean = editUsername.trim().toLowerCase();
    if (!clean || clean === String(editingAcc.username || '').toLowerCase()) {
      setEditAvail({ status: 'idle', reason: '' });
      return undefined;
    }
    if (clean.length < 3 || clean.length > 32 || !/^[a-z0-9._-]+$/.test(clean)) {
      setEditAvail({
        status: 'invalid',
        reason: '3–32 حرفاً إنجليزياً صغيراً أو أرقاماً أو (. _ -)',
      });
      return undefined;
    }
    setEditAvail({ status: 'checking', reason: 'جاري التحقق...' });
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(clean, editingAcc.id);
        setEditAvail(
          res?.available
            ? { status: 'available', reason: 'متاح' }
            : { status: 'taken', reason: res?.reason || 'مستخدم بالفعل' }
        );
      } catch {
        setEditAvail({ status: 'idle', reason: '' });
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [editUsername, editingAcc]);

  function triggerPickPhoto(target) {
    if (!isOnlineApi) return;
    setPhotoTarget(target);
    fileInputRef.current?.click();
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !photoTarget) return;
    setCropFile(file);
  }

  async function handleConfirmCrop({ dataUrl }) {
    if (!photoTarget) return;
    setSavingPhoto(true);
    try {
      if (photoTarget.kind === 'role') {
        await uploadRoleDefaultAvatar(photoTarget.id, dataUrl);
        onToast?.(`تم تحديث صورة ${photoTarget.label}`);
      } else {
        const res = await uploadAccountAvatar(photoTarget.id, dataUrl);
        if (photoTarget.id === authUser?.id && res?.avatar_url) {
          onUserUpdated?.({ ...authUser, avatar_url: res.avatar_url });
        }
        onToast?.(`تم تحديث صورة ${photoTarget.label}`);
      }
      setCropFile(null);
      setPhotoTarget(null);
      await loadDirectory();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ الصورة', 'error');
    } finally {
      setSavingPhoto(false);
    }
  }

  async function handleConfirmDeletePhoto() {
    if (!confirmDeletePhoto) return;
    setSavingPhoto(true);
    try {
      if (confirmDeletePhoto.kind === 'role') {
        await deleteRoleDefaultAvatar(confirmDeletePhoto.id);
      } else {
        await deleteAccountAvatar(confirmDeletePhoto.id);
      }
      onToast?.(`تم حذف صورة ${confirmDeletePhoto.label}`);
      setConfirmDeletePhoto(null);
      await loadDirectory();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حذف الصورة', 'error');
    } finally {
      setSavingPhoto(false);
    }
  }

  function openEditAccount(acc) {
    setEditingAcc(acc);
    setEditDisplayName(acc.display_name || '');
    setEditUsername(acc.username || '');
    setEditPassword('');
    setShowEditPassword(false);
    setEditRole(acc.role || 'cashier');
    setEditColor(acc.avatar_color || AVATAR_COLORS[0].hex);
    setEditActive(Boolean(acc.is_active));
    setEditAvail({ status: 'idle', reason: '' });
  }

  async function handleSaveAccountCredentials(e) {
    e?.preventDefault();
    if (!editingAcc || savingEdit) return;
    if (editAvail.status === 'invalid' || editAvail.status === 'taken') {
      onToast?.(editAvail.reason || 'اسم المستخدم غير صالح', 'error');
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        display_name: editDisplayName.trim(),
        username: editUsername.trim().toLowerCase(),
        role: editRole,
        avatar_color: editColor,
        is_active: editActive,
      };
      if (editPassword.trim()) {
        payload.new_password = normalizeDigitsClient(editPassword).trim();
      }
      const res = await updateAccountCredentials(editingAcc.id, payload);
      if (editingAcc.id === authUser?.id && res?.account) {
        onUserUpdated?.(res.account, res.token);
      }
      setEditingAcc(null);
      onToast?.('تم حفظ التعديلات');
      await loadDirectory();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تحديث الحساب', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleCreateAccount(e) {
    e?.preventDefault();
    if (savingCreate) return;
    if (!newDisplayName.trim() || !newPassword.trim()) {
      onToast?.('أدخل الاسم وكلمة المرور', 'error');
      return;
    }
    setSavingCreate(true);
    try {
      await apiRequest('/api/rbac/users', 'POST', {
        display_name: newDisplayName.trim(),
        username: newUsername.trim().toLowerCase() || undefined,
        role: newRole,
        password: normalizeDigitsClient(newPassword).trim(),
        avatar_color: newColor,
      });
      setCreateOpen(false);
      setNewDisplayName('');
      setNewUsername('');
      setNewPassword('');
      onToast?.('تم إنشاء الحساب');
      await loadDirectory();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر إنشاء الحساب', 'error');
    } finally {
      setSavingCreate(false);
    }
  }

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((a) => {
      if (roleFilter !== 'all' && a.role !== roleFilter) return false;
      if (q) {
        const hay = `${a.display_name || ''} ${a.username || ''} ${a.role_label || ''} ${a.emp_code || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, roleFilter, searchQuery]);

  const roleFilterChips = useMemo(
    () => [
      { id: 'all', label: 'الكل', count: accounts.length },
      ...roles.map((r) => ({
        id: r.id,
        label: r.shortLabel || r.label,
        count: r.total_accounts,
      })),
    ],
    [roles, accounts.length]
  );

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Part A: 10-Role Compact Tile Grid */}
      <section className="space-y-3">
        <SectionHeader
          title="صور الأدوار"
          count={roles.length}
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                icon="person_add"
                disabled={!isOnlineApi}
                onClick={() => setCreateOpen(true)}
              >
                حساب جديد
              </Button>
              {onJumpToRbacMatrix && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="tune"
                  onClick={onJumpToRbacMatrix}
                >
                  الصلاحيات
                </Button>
              )}
            </div>
          }
        />

        {loading && roles.length === 0 ? (
          <SkeletonList count={3} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {roles.map((r) => {
              const selected = roleFilter === r.id;
              const canEditThisRole = isOwner || r.id !== 'owner';
              return (
                <div
                  key={r.id}
                  className={`p-2.5 rounded-[var(--g-radius-md)] border flex flex-col items-center text-center gap-1.5 transition-[border-color,background-color] duration-150 ${
                    selected
                      ? 'border-primary bg-surface-tint'
                      : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <RoleAvatar
                    src={r.avatar_url}
                    name={r.shortLabel || r.label}
                    role={r.id}
                    color={r.color}
                    preset={r.avatar_preset || 'role_default'}
                    size="md"
                    editable={canEditThisRole && isOnlineApi}
                    onClick={
                      canEditThisRole && isOnlineApi
                        ? () =>
                            triggerPickPhoto({
                              kind: 'role',
                              id: r.id,
                              label: r.shortLabel || r.label,
                            })
                        : undefined
                    }
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setRoleFilter((prev) => (prev === r.id ? 'all' : r.id))
                    }
                    className="w-full min-h-[44px] flex flex-col items-center justify-center cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-ink line-clamp-1">
                      {r.shortLabel || r.label}
                    </span>
                    <span className="num-ltr text-[11px] text-ink-muted">
                      {r.active_accounts}
                    </span>
                  </button>

                  {r.avatar_url && canEditThisRole && isOnlineApi && (
                    <button
                      type="button"
                      aria-label={`حذف صورة ${r.shortLabel || r.label}`}
                      onClick={() =>
                        setConfirmDeletePhoto({
                          kind: 'role',
                          id: r.id,
                          label: r.shortLabel || r.label,
                        })
                      }
                      className="w-11 h-9 rounded-[var(--g-radius-sm)] text-danger hover:bg-danger-bg flex items-center justify-center cursor-pointer"
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Part B: Accounts Hairline Directory */}
      <section className="space-y-3">
        <SectionHeader title="الحسابات" count={filteredAccounts.length} />

        <SearchFilterBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="بحث بالاسم أو المعرف"
        />

        <FilterChipRail
          items={roleFilterChips}
          activeId={roleFilter}
          onSelect={setRoleFilter}
        />

        {loading && accounts.length === 0 ? (
          <SkeletonList count={4} />
        ) : filteredAccounts.length === 0 ? (
          <EmptyState compact icon="person_search" title="لا توجد حسابات" />
        ) : (
          <GroupedList>
            {filteredAccounts.map((acc) => {
              const isRevealed = Boolean(revealedPassIds[acc.id]);
              const canEditAcc = isOwner || acc.role !== 'owner';
              return (
                <div
                  key={acc.id}
                  className={`px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    acc.is_active ? '' : 'opacity-65'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RoleAvatar
                      src={acc.effective_avatar_url}
                      name={acc.display_name}
                      role={acc.role}
                      color={acc.avatar_color}
                      preset={acc.avatar_preset || 'role_default'}
                      size="md"
                      editable={canEditAcc && isOnlineApi}
                      onClick={
                        canEditAcc && isOnlineApi
                          ? () =>
                              triggerPickPhoto({
                                kind: 'account',
                                id: acc.id,
                                label: acc.display_name,
                              })
                          : undefined
                      }
                    />

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">
                          {acc.display_name}
                        </span>
                        {!acc.is_active ? (
                          <StatusDot tone="danger" tintedText label="موقوف" />
                        ) : acc.id === authUser?.id ? (
                          <StatusDot tone="success" label="أنت" />
                        ) : null}
                      </div>

                      <div className="text-xs text-ink-muted truncate">
                        <span>{acc.role_short_label || acc.role_label}</span>
                        {acc.username && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="num-ltr">@{acc.username}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-1 flex-wrap shrink-0">
                    {acc.password_value && (
                      <div className="flex items-center">
                        <span className="px-2 py-1 text-xs font-medium num-ltr text-ink-muted">
                          {isRevealed ? acc.password_value : '••••'}
                        </span>
                        <button
                          type="button"
                          aria-label={isRevealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                          onClick={() =>
                            setRevealedPassIds((prev) => ({
                              ...prev,
                              [acc.id]: !prev[acc.id],
                            }))
                          }
                          className="w-11 h-11 rounded-full text-ink-muted hover:text-ink hover:bg-surface-2 flex items-center justify-center cursor-pointer"
                        >
                          <Icon
                            name={isRevealed ? 'visibility_off' : 'visibility'}
                            size={18}
                          />
                        </button>
                        <button
                          type="button"
                          aria-label="نسخ كلمة المرور"
                          onClick={async () => {
                            try {
                              await copyTextSafe(acc.password_value);
                              onToast?.(`تم نسخ كلمة مرور ${acc.display_name}`);
                            } catch {
                              onToast?.('تعذر النسخ', 'error');
                            }
                          }}
                          className="w-11 h-11 rounded-full text-ink-muted hover:text-primary hover:bg-surface-2 flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="content_copy" size={18} />
                        </button>
                      </div>
                    )}

                    {canEditAcc && isOnlineApi && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="edit"
                        onClick={() => openEditAccount(acc)}
                      >
                        تعديل
                      </Button>
                    )}

                    {onOpenPersonLog && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onOpenPersonLog(acc.employee_id || acc.id, acc.display_name)
                        }
                      >
                        السجل
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </section>

      {/* Edit Account BottomSheet */}
      <BottomSheet
        open={Boolean(editingAcc)}
        onClose={savingEdit ? undefined : () => setEditingAcc(null)}
        title={editingAcc?.display_name || 'تعديل الحساب'}
        maxWidth="max-w-lg"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={savingEdit}
              onClick={() => setEditingAcc(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={savingEdit}
              onClick={handleSaveAccountCredentials}
            >
              حفظ
            </Button>
          </div>
        }
      >
        {editingAcc && (
          <form onSubmit={handleSaveAccountCredentials} className="space-y-4 py-1">
            <div className="pb-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <RoleAvatar
                  src={editingAcc.effective_avatar_url}
                  name={editDisplayName}
                  role={editRole}
                  color={editColor}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">
                    {editDisplayName || editingAcc.display_name}
                  </div>
                  {editUsername && (
                    <div className="text-xs text-ink-muted num-ltr">
                      @{editUsername}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="photo_camera"
                  onClick={() =>
                    triggerPickPhoto({
                      kind: 'account',
                      id: editingAcc.id,
                      label: editingAcc.display_name,
                    })
                  }
                >
                  تغيير
                </Button>
                {editingAcc.avatar_url && (
                  <Button
                    variant="dangerTonal"
                    size="sm"
                    icon="delete"
                    onClick={() =>
                      setConfirmDeletePhoto({
                        kind: 'account',
                        id: editingAcc.id,
                        label: editingAcc.display_name,
                      })
                    }
                  >
                    حذف
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الاسم
                </label>
                <input
                  type="text"
                  required
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="g-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الدور
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="g-input font-medium"
                >
                  {Object.values(ROLES_METADATA)
                    .filter((r) => isOwner || r.id !== 'owner')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.shortLabel || r.label}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  اسم المستخدم
                </label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={editUsername}
                  onChange={(e) =>
                    setEditUsername(e.target.value.replace(/\s+/g, '_').toLowerCase())
                  }
                  className="g-input num-ltr"
                />
                {editAvail.status !== 'idle' && (
                  <div className="mt-1">
                    <StatusDot
                      tone={
                        editAvail.status === 'available'
                          ? 'success'
                          : editAvail.status === 'checking'
                          ? 'neutral'
                          : 'danger'
                      }
                      tintedText={editAvail.status !== 'checking'}
                      label={editAvail.reason}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  كلمة مرور جديدة
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    dir="ltr"
                    value={editPassword}
                    onChange={(e) => setEditPassword(normalizeDigitsClient(e.target.value))}
                    placeholder="اختياري"
                    className="g-input num-ltr pl-12 pr-3.5 placeholder:text-right"
                  />
                  <button
                    type="button"
                    aria-label={showEditPassword ? 'إخفاء' : 'إظهار'}
                    onClick={() => setShowEditPassword((v) => !v)}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-ink-muted hover:bg-surface flex items-center justify-center"
                  >
                    <Icon
                      name={showEditPassword ? 'visibility_off' : 'visibility'}
                      size={18}
                    />
                  </button>
                </div>
              </div>
            </div>

            <GroupedList>
              <ToggleSwitch
                grouped
                checked={editActive}
                onChange={setEditActive}
                label="حساب نشط"
              />
            </GroupedList>
          </form>
        )}
      </BottomSheet>

      {/* Create New Role Account Sheet */}
      <BottomSheet
        open={createOpen}
        onClose={savingCreate ? undefined : () => setCreateOpen(false)}
        title="حساب جديد"
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={savingCreate}
              onClick={() => setCreateOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={savingCreate}
              onClick={handleCreateAccount}
            >
              إنشاء
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateAccount} className="space-y-3.5 py-1">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              الدور
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="g-input font-medium"
            >
              {Object.values(ROLES_METADATA)
                .filter((r) => isOwner || r.id !== 'owner')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.shortLabel || r.label}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              الاسم
            </label>
            <input
              type="text"
              required
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="الاسم"
              className="g-input"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              اسم المستخدم
            </label>
            <input
              type="text"
              dir="ltr"
              value={newUsername}
              onChange={(e) =>
                setNewUsername(e.target.value.replace(/\s+/g, '_').toLowerCase())
              }
              placeholder="تلقائي"
              className="g-input num-ltr placeholder:text-right"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              كلمة المرور
            </label>
            <input
              type="text"
              dir="ltr"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(normalizeDigitsClient(e.target.value))}
              placeholder="كلمة المرور"
              className="g-input num-ltr font-semibold placeholder:text-right"
            />
          </div>
        </form>
      </BottomSheet>

      <AvatarCropModal
        open={Boolean(cropFile)}
        onClose={() => {
          setCropFile(null);
          setPhotoTarget(null);
        }}
        imageFileOrSrc={cropFile}
        targetLabel={photoTarget?.label || ''}
        canSetRoleDefault={false}
        saving={savingPhoto}
        onConfirmCrop={handleConfirmCrop}
      />

      <ConfirmSheet
        open={Boolean(confirmDeletePhoto)}
        onClose={() => setConfirmDeletePhoto(null)}
        onConfirm={handleConfirmDeletePhoto}
        loading={savingPhoto}
        tone="danger"
        title="حذف الصورة"
        description={`حذف صورة ${confirmDeletePhoto?.label || ''}؟`}
        confirmLabel="حذف"
      />
    </div>
  );
}
