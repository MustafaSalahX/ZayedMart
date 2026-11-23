import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BottomSheet,
  Button,
  Card,
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
} from './ui/index.js';
import { apiRequest, clearMasterAuditLogs } from '../lib/api.js';
import {
  buildAuditLogsWhatsAppText,
  exportAuditLogsCsv,
  exportAuditLogsWord,
  formatTimeWithSeconds,
  openWhatsAppShare,
} from '../lib/exportUtils.js';
import { ROLE_DEFAULT_COLORS } from '../lib/navigation.js';

const SWATCH_COLORS = Object.values(ROLE_DEFAULT_COLORS);

const QUICK_ROLE_PRESETS = [
  { role: 'cashier', label: 'كاشير', color: ROLE_DEFAULT_COLORS.cashier },
  { role: 'hall', label: 'صالة', color: ROLE_DEFAULT_COLORS.hall },
  { role: 'security', label: 'أمن', color: ROLE_DEFAULT_COLORS.security },
  { role: 'cctv', label: 'كاميرات', color: ROLE_DEFAULT_COLORS.cctv },
  { role: 'supervisor', label: 'مشرف', color: ROLE_DEFAULT_COLORS.supervisor },
  { role: 'warehouse', label: 'مخزن', color: ROLE_DEFAULT_COLORS.warehouse },
  { role: 'delivery', label: 'دليفري', color: ROLE_DEFAULT_COLORS.delivery },
  { role: 'kiosk', label: 'كشك', color: ROLE_DEFAULT_COLORS.kiosk },
];

function arraysEqualAsSets(a = [], b = []) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

/**
 * Detoxed Security, Accounts, Role Matrix & Audit Log Panel (`الأمان`).
 * Zero tinted promo banners, zero verbose subtitles or toggle prose, zero boxes-inside-boxes,
 * preserving 44x44px controls, dirty-state save guard, and `<ConfirmSheet />` protections.
 */
export default function RbacSecurityPanel({
  canManageUsers = false,
  canViewAudit = false,
  currentUserId = '',
  onOpenPersonLog,
  onRefreshParent,
  onToast,
}) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState({
    rolesMeta: {},
    permissionsCatalog: [],
    policies: {},
    users: [],
    activeSessionsCount: 0,
    auditLogs: [],
  });

  const [section, setSection] = useState(canManageUsers ? 'users' : 'audit');
  const [revealedIds, setRevealedIds] = useState({});

  const [newDisplayName, setNewDisplayName] = useState('كاشير الشفت');
  const [newRole, setNewRole] = useState('cashier');
  const [newPassword, setNewPassword] = useState('');
  const [newColor, setNewColor] = useState(ROLE_DEFAULT_COLORS.cashier);
  const [creatingUser, setCreatingUser] = useState(false);

  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('cashier');
  const [editPassword, setEditPassword] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editCustomPerms, setEditCustomPerms] = useState([]);
  const [savingUserEdit, setSavingUserEdit] = useState(false);

  const [selectedMatrixRole, setSelectedMatrixRole] = useState('cashier');
  const [draftPerms, setDraftPerms] = useState([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [pendingRoleSwitch, setPendingRoleSwitch] = useState(null);
  const [pendingSectionSwitch, setPendingSectionSwitch] = useState(null);

  const [deleteUserTarget, setDeleteUserTarget] = useState(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [confirmRevokeSessions, setConfirmRevokeSessions] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [confirmClearAudit, setConfirmClearAudit] = useState(false);
  const [clearingAudit, setClearingAudit] = useState(false);

  const [auditRoleFilter, setAuditRoleFilter] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [showAllAudit, setShowAllAudit] = useState(false);

  const loadRbac = useCallback(async () => {
    try {
      const res = await apiRequest('/api/rbac/overview');
      setOverview(res);
    } catch (err) {
      onToast?.(err?.message || 'تعذر تحميل بيانات الأمان', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadRbac();
  }, [loadRbac]);

  useEffect(() => {
    setDraftPerms(overview.policies?.[selectedMatrixRole] || []);
  }, [overview.policies, selectedMatrixRole]);

  const savedRolePerms = useMemo(
    () => overview.policies?.[selectedMatrixRole] || [],
    [overview.policies, selectedMatrixRole]
  );

  const isMatrixDirty = useMemo(() => {
    if (selectedMatrixRole === 'owner') return false;
    return !arraysEqualAsSets(draftPerms, savedRolePerms);
  }, [draftPerms, savedRolePerms, selectedMatrixRole]);

  function applyQuickPreset(preset) {
    setNewRole(preset.role);
    setNewDisplayName(preset.label);
    setNewColor(preset.color);
  }

  function toggleReveal(id) {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function copyPasswordSafe(val) {
    if (!val) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(val);
        onToast?.('تم نسخ كلمة المرور');
        return;
      }
    } catch {
      // fallback
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onToast?.('تم نسخ كلمة المرور');
    } catch {
      onToast?.('تعذر نسخ كلمة المرور', 'error');
    }
  }

  function requestSelectMatrixRole(roleId) {
    if (roleId === selectedMatrixRole) return;
    if (isMatrixDirty) {
      setPendingRoleSwitch(roleId);
      return;
    }
    setSelectedMatrixRole(roleId);
  }

  function requestSwitchSection(nextSec) {
    if (nextSec === section) return;
    if (section === 'matrix' && isMatrixDirty) {
      setPendingSectionSwitch(nextSec);
      return;
    }
    setSection(nextSec);
  }

  function toggleDraftPerm(permId) {
    if (selectedMatrixRole === 'owner') return;
    setDraftPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  }

  async function handleSaveRolePolicy() {
    if (selectedMatrixRole === 'owner' || savingPolicy) return;
    setSavingPolicy(true);
    try {
      await apiRequest(`/api/rbac/policies/${selectedMatrixRole}`, 'PUT', {
        permissions: draftPerms,
      });
      onToast?.('تم حفظ الصلاحيات');
      await loadRbac();
      onRefreshParent?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حفظ الصلاحيات', 'error');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleResetRolePolicy() {
    if (selectedMatrixRole === 'owner' || savingPolicy) return;
    setSavingPolicy(true);
    try {
      const res = await apiRequest(
        `/api/rbac/policies/${selectedMatrixRole}/reset`,
        'POST'
      );
      if (Array.isArray(res?.permissions)) {
        setDraftPerms(res.permissions);
      }
      onToast?.('تمت الاستعادة للافتراضي');
      await loadRbac();
      onRefreshParent?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر استعادة الافتراضي', 'error');
    } finally {
      setSavingPolicy(false);
    }
  }

  function handleSelectAllRolePerms() {
    if (selectedMatrixRole === 'owner') return;
    setDraftPerms((overview.permissionsCatalog || []).map((p) => p.id));
  }

  function handleClearAllRolePerms() {
    if (selectedMatrixRole === 'owner') return;
    setDraftPerms([]);
  }

  async function handleCreatePassword(e) {
    e?.preventDefault?.();
    if (!newPassword.trim() || creatingUser) return;
    setCreatingUser(true);
    try {
      await apiRequest('/api/rbac/users', 'POST', {
        display_name: newDisplayName.trim(),
        role: newRole,
        password: newPassword.trim(),
        avatar_color: newColor,
      });
      setNewPassword('');
      onToast?.(`تم إنشاء حساب "${newDisplayName.trim()}"`);
      await loadRbac();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إنشاء الحساب', 'error');
    } finally {
      setCreatingUser(false);
    }
  }

  function openEditUserModal(u) {
    setEditingUser(u);
    setEditName(u.display_name);
    setEditRole(u.role);
    setEditPassword('');
    setEditActive(Boolean(u.is_active));
    setEditCustomPerms(
      Array.isArray(u.custom_permissions) ? u.custom_permissions : []
    );
  }

  function toggleUserCustomPerm(permId) {
    setEditCustomPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  }

  async function handleSaveUserEdit(e) {
    e?.preventDefault?.();
    if (!editingUser || savingUserEdit) return;
    setSavingUserEdit(true);
    try {
      await apiRequest(`/api/rbac/users/${editingUser.id}`, 'PUT', {
        display_name: editName.trim(),
        role: editRole,
        password: editPassword.trim() || undefined,
        is_active: editActive,
        avatar_color: editingUser.avatar_color,
        custom_permissions: editCustomPerms,
      });
      setEditingUser(null);
      onToast?.('تم حفظ التعديلات');
      await loadRbac();
      onRefreshParent?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حفظ التعديلات', 'error');
    } finally {
      setSavingUserEdit(false);
    }
  }

  async function handleConfirmDeletePassword() {
    if (!deleteUserTarget || deletingUser) return;
    setDeletingUser(true);
    try {
      await apiRequest(`/api/rbac/users/${deleteUserTarget.id}`, 'DELETE');
      setDeleteUserTarget(null);
      onToast?.('تم حذف الحساب');
      await loadRbac();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حذف الحساب', 'error');
    } finally {
      setDeletingUser(false);
    }
  }

  async function handleConfirmRevokeAllSessions() {
    if (revokingSessions) return;
    setRevokingSessions(true);
    try {
      const res = await apiRequest('/api/rbac/sessions/revoke-all', 'POST');
      setConfirmRevokeSessions(false);
      onToast?.(`تم إنهاء ${res.revokedCount} جلسة`);
      await loadRbac();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إنهاء الجلسات', 'error');
    } finally {
      setRevokingSessions(false);
    }
  }

  async function handleConfirmClearAuditLogs() {
    if (clearingAudit) return;
    setClearingAudit(true);
    try {
      await clearMasterAuditLogs();
      setConfirmClearAudit(false);
      onToast?.('تم مسح السجل');
      await loadRbac();
    } catch (err) {
      onToast?.(err?.message || 'تعذر مسح السجل', 'error');
    } finally {
      setClearingAudit(false);
    }
  }

  const groupedPermissions = useMemo(() => {
    const groups = {};
    for (const p of overview.permissionsCatalog || []) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [overview.permissionsCatalog]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return (overview.auditLogs || []).filter((log) => {
      const actorRole = log.actor_role || log.role || '';
      if (auditRoleFilter !== 'all' && actorRole !== auditRoleFilter) return false;
      if (q) {
        const hay = `${log.actor_name || log.user_name || ''} ${log.action || ''} ${log.target_label || ''} ${log.details || ''} ${actorRole}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [overview.auditLogs, auditRoleFilter, auditSearch]);

  const sectionTabs = useMemo(() => {
    const items = [];
    if (canManageUsers) {
      items.push({
        id: 'users',
        label: 'الحسابات',
        count: overview.users?.length || 0,
      });
      items.push({
        id: 'matrix',
        label: 'الصلاحيات',
        count: overview.permissionsCatalog?.length || 0,
      });
    }
    if (canViewAudit) {
      items.push({
        id: 'audit',
        label: 'السجل',
        count: overview.auditLogs?.length || 0,
      });
    }
    return items;
  }, [
    canManageUsers,
    canViewAudit,
    overview.users?.length,
    overview.permissionsCatalog?.length,
    overview.auditLogs?.length,
  ]);

  if (loading) {
    return <SkeletonList rows={5} />;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="الأمان"
        subtitle={`أجهزة متصلة: ${overview.activeSessionsCount}`}
        actions={
          canManageUsers && (
            <Button
              variant="dangerTonal"
              size="sm"
              icon="phonelink_erase"
              onClick={() => setConfirmRevokeSessions(true)}
            >
              إنهاء باقي الأجهزة
            </Button>
          )
        }
      />

      <FilterChipRail
        items={sectionTabs}
        activeId={section}
        onSelect={requestSwitchSection}
      />

      {/* SECTION 1: ACCOUNTS & PASSWORDS */}
      {canManageUsers && section === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <Card padding="md" className="lg:col-span-5 space-y-4">
            <SectionHeader title="حساب جديد" />

            <form onSubmit={handleCreatePassword} className="space-y-3.5">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ROLE_PRESETS.map((p) => (
                  <button
                    key={p.role}
                    type="button"
                    onClick={() => applyQuickPreset(p)}
                    className={`min-h-[40px] sm:min-h-[34px] px-3 py-1 rounded-[var(--g-radius-btn)] text-xs font-medium border transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                      newRole === p.role
                        ? 'bg-primary-solid text-on-primary border-transparent'
                        : 'bg-transparent border-line text-ink hover:border-line-strong'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الدور *
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="g-input"
                >
                  {Object.values(overview.rolesMeta || {}).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الاسم *
                </label>
                <input
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="كاشير صباحي"
                  className="g-input"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  كلمة المرور *
                </label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="205"
                  className="g-input num-ltr"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-ink-muted mb-1">
                  اللون
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {SWATCH_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      aria-label={`اللون ${c}`}
                      className="w-11 h-11 rounded-full flex items-center justify-center bg-transparent hover:bg-surface-2 cursor-pointer"
                    >
                      <span
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full ${
                          newColor === c
                            ? 'ring-2 ring-offset-2 ring-[var(--g-primary)]'
                            : ''
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                fullWidth
                loading={creatingUser}
              >
                إنشاء الحساب
              </Button>
            </form>
          </Card>

          <div className="lg:col-span-7">
            <GroupedList label="الحسابات" count={overview.users?.length || 0}>
              {(overview.users || []).map((u) => {
                const roleMeta = overview.rolesMeta?.[u.role] || { label: u.role };
                const isRevealed = Boolean(revealedIds[u.id]);
                const customCount = Array.isArray(u.custom_permissions)
                  ? u.custom_permissions.length
                  : 0;
                const metaParts = [
                  roleMeta.shortLabel || roleMeta.label,
                  customCount > 0 ? `+${customCount} صلاحية` : '',
                  u.id === currentUserId ? 'أنت' : '',
                  !u.is_active ? 'موقوف' : '',
                ].filter(Boolean);

                return (
                  <div
                    key={u.id}
                    className={`min-h-[60px] px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      u.is_active ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RoleAvatar
                        src={u.avatar_url || ''}
                        name={u.display_name}
                        role={u.role}
                        color={u.avatar_color || ''}
                        size="sm"
                        shape="circle"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink truncate">
                          {u.display_name}
                        </div>
                        <div className="text-xs text-ink-muted truncate">
                          {metaParts.join(' · ')}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-1 flex-wrap shrink-0">
                      <span className="num-ltr text-xs font-semibold text-ink px-2">
                        {isRevealed ? u.password_value || '—' : '••••'}
                      </span>

                      {u.password_value && (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleReveal(u.id)}
                            aria-label={isRevealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                            className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
                          >
                            <Icon
                              name={isRevealed ? 'visibility_off' : 'visibility'}
                              size={18}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => copyPasswordSafe(u.password_value)}
                            aria-label="نسخ كلمة المرور"
                            className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
                          >
                            <Icon name="content_copy" size={18} />
                          </button>
                        </>
                      )}

                      {onOpenPersonLog && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenPersonLog(u.id, u.display_name)}
                        >
                          سجل
                        </Button>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditUserModal(u)}
                        aria-label={`تعديل ${u.display_name}`}
                        className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
                      >
                        <Icon name="edit" size={18} />
                      </button>

                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => setDeleteUserTarget(u)}
                          aria-label={`حذف ${u.display_name}`}
                          className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-danger-bg text-ink-muted hover:text-danger inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
                        >
                          <Icon name="delete" size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </GroupedList>
          </div>
        </div>
      )}

      {/* SECTION 2: ROLE PERMISSIONS MATRIX */}
      {canManageUsers && section === 'matrix' && (
        <div className="space-y-4">
          <SectionHeader
            title="الصلاحيات"
            badge={
              isMatrixDirty ? (
                <StatusDot tone="warning" label="غير محفوظ" tintedText pulse />
              ) : null
            }
            actions={
              selectedMatrixRole !== 'owner' && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={savingPolicy}
                    onClick={handleSelectAllRolePerms}
                  >
                    تحديد الكل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={savingPolicy}
                    onClick={handleClearAllRolePerms}
                  >
                    إلغاء الكل
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={savingPolicy}
                    onClick={handleResetRolePolicy}
                  >
                    افتراضي
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingPolicy}
                    onClick={handleSaveRolePolicy}
                  >
                    حفظ
                  </Button>
                </div>
              )
            }
          />

          <FilterChipRail
            activeId={selectedMatrixRole}
            onSelect={requestSelectMatrixRole}
            items={Object.values(overview.rolesMeta || {}).map((r) => ({
              id: r.id,
              label: r.shortLabel || r.label,
              count: (overview.policies?.[r.id] || []).length,
            }))}
          />

          {selectedMatrixRole === 'owner' && (
            <p className="text-xs font-medium text-ink-muted m-0">
              المالك يمتلك كافة الصلاحيات تلقائياً
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(groupedPermissions).map(([groupName, perms]) => (
              <GroupedList key={groupName} label={groupName}>
                {perms.map((perm) => {
                  const checked =
                    selectedMatrixRole === 'owner' || draftPerms.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className={`min-h-[46px] px-3.5 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium transition-[background-color] duration-150 ${
                        selectedMatrixRole === 'owner'
                          ? 'opacity-75 cursor-not-allowed text-ink-muted'
                          : checked
                          ? 'text-ink cursor-pointer hover:bg-surface-tint'
                          : 'text-ink-muted cursor-pointer hover:bg-surface-tint'
                      }`}
                    >
                      <span className="truncate">{perm.label}</span>
                      <input
                        type="checkbox"
                        disabled={selectedMatrixRole === 'owner'}
                        checked={checked}
                        onChange={() => toggleDraftPerm(perm.id)}
                        className="w-5 h-5 accent-[var(--g-primary-solid)] shrink-0"
                      />
                    </label>
                  );
                })}
              </GroupedList>
            ))}
          </div>

          {isMatrixDirty && (
            <div className="sticky bottom-[calc(var(--bottom-nav-h)+0.75rem)] md:bottom-4 z-20 px-4 py-3 rounded-[var(--g-radius-md)] bg-surface-elevated border border-line-strong shadow-[var(--g-shadow-elevated)] flex items-center justify-between gap-3 flex-wrap">
              <StatusDot tone="warning" label="تعديلات غير محفوظة" tintedText />
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={savingPolicy}
                  onClick={() => setDraftPerms(savedRolePerms)}
                >
                  تراجع
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingPolicy}
                  onClick={handleSaveRolePolicy}
                >
                  حفظ
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: AUDIT LOG */}
      {canViewAudit && section === 'audit' && (
        <div className="space-y-4">
          <SectionHeader
            title="السجل"
            count={filteredAuditLogs.length}
            actions={
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportAuditLogsCsv(filteredAuditLogs)}
                >
                  Excel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportAuditLogsWord(filteredAuditLogs)}
                >
                  Word
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    openWhatsAppShare(buildAuditLogsWhatsAppText(filteredAuditLogs))
                  }
                >
                  واتساب
                </Button>
                {canManageUsers && filteredAuditLogs.length > 0 && (
                  <Button
                    variant="dangerTonal"
                    size="sm"
                    onClick={() => setConfirmClearAudit(true)}
                  >
                    مسح
                  </Button>
                )}
              </div>
            }
          />

          <div className="space-y-2.5">
            <SearchFilterBar
              value={auditSearch}
              onChange={setAuditSearch}
              placeholder="بحث في السجل..."
            />

            <FilterChipRail
              activeId={auditRoleFilter}
              onSelect={setAuditRoleFilter}
              items={[
                { id: 'all', label: 'الكل' },
                { id: 'owner', label: 'الإدارة' },
                { id: 'cashier', label: 'الكاشير' },
                { id: 'security', label: 'الأمن' },
                { id: 'supervisor', label: 'المشرفون' },
                { id: 'cctv', label: 'الكاميرات' },
              ]}
            />
          </div>

          {filteredAuditLogs.length === 0 ? (
            <EmptyState compact title="لا توجد أحداث مطابقة" />
          ) : (
            <>
              <GroupedList>
                {(showAllAudit
                  ? filteredAuditLogs
                  : filteredAuditLogs.slice(0, 25)
                ).map((log) => {
                  const actorName = log.actor_name || log.user_name || 'النظام';
                  const actorRole = log.actor_role || log.role || '';
                  const roleShort = actorRole
                    ? overview.rolesMeta?.[actorRole]?.shortLabel || actorRole
                    : '';
                  const headlineParts = [
                    log.action,
                    actorName,
                    roleShort,
                    log.target_label,
                  ].filter(Boolean);

                  return (
                    <div
                      key={log.id}
                      className="min-h-[52px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-medium text-ink truncate">
                          {headlineParts.join(' · ')}
                        </div>
                        {log.details && (
                          <div className="text-xs text-ink-muted truncate mt-0.5">
                            {log.details}
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-ink-muted flex items-center gap-2 shrink-0 num-ltr">
                        {log.ip_address && (
                          <span className="hidden sm:inline">{log.ip_address}</span>
                        )}
                        <span className="font-medium text-ink">
                          {log.timestamp
                            ? new Date(log.timestamp).toLocaleString('ar-EG')
                            : formatTimeWithSeconds(log.timestamp)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </GroupedList>

              {filteredAuditLogs.length > 25 && (
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  onClick={() => setShowAllAudit((v) => !v)}
                >
                  {showAllAudit
                    ? 'عرض أقل'
                    : `عرض الكل (${filteredAuditLogs.length})`}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Edit User / Custom Permissions BottomSheet */}
      <BottomSheet
        open={Boolean(editingUser)}
        onClose={() => !savingUserEdit && setEditingUser(null)}
        title="تعديل الحساب"
        subtitle={editingUser?.display_name || ''}
        maxWidth="max-w-xl"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={savingUserEdit}
              onClick={() => setEditingUser(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={savingUserEdit}
              onClick={handleSaveUserEdit}
            >
              حفظ
            </Button>
          </div>
        }
      >
        {editingUser && (
          <form onSubmit={handleSaveUserEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الاسم *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
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
                  className="g-input"
                >
                  {Object.values(overview.rolesMeta || {}).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                كلمة مرور جديدة
              </label>
              <input
                type="text"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder={editingUser.password_value || 'اتركها فارغة بدون تغيير'}
                className="g-input num-ltr"
              />
            </div>

            <div className="border-y border-line">
              <ToggleSwitch
                checked={editActive}
                onChange={setEditActive}
                label="تفعيل الحساب"
              />
            </div>

            {editRole !== 'owner' && (
              <GroupedList label="صلاحيات إضافية" count={editCustomPerms.length}>
                {(overview.permissionsCatalog || []).map((perm) => {
                  const roleHasIt = (overview.policies?.[editRole] || []).includes(
                    perm.id
                  );
                  const userHasExtra = editCustomPerms.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className={`min-h-[44px] px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-medium ${
                        roleHasIt
                          ? 'opacity-65 cursor-not-allowed text-ink-muted'
                          : 'text-ink cursor-pointer hover:bg-surface-tint'
                      }`}
                    >
                      <span className="truncate">
                        {perm.label}
                        {roleHasIt ? ' · ضمن الدور' : ''}
                      </span>
                      <input
                        type="checkbox"
                        checked={roleHasIt || userHasExtra}
                        disabled={roleHasIt}
                        onChange={() => toggleUserCustomPerm(perm.id)}
                        className="w-5 h-5 accent-[var(--g-primary-solid)] shrink-0"
                      />
                    </label>
                  );
                })}
              </GroupedList>
            )}
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(pendingRoleSwitch || pendingSectionSwitch)}
        onClose={() => {
          setPendingRoleSwitch(null);
          setPendingSectionSwitch(null);
        }}
        onConfirm={() => {
          if (pendingRoleSwitch) {
            setSelectedMatrixRole(pendingRoleSwitch);
            setPendingRoleSwitch(null);
          } else if (pendingSectionSwitch) {
            setDraftPerms(savedRolePerms);
            setSection(pendingSectionSwitch);
            setPendingSectionSwitch(null);
          }
        }}
        tone="warning"
        title="تجاهل التعديلات؟"
        description="توجد تعديلات غير محفوظة على صلاحيات الدور الحالي."
        confirmLabel="تجاهل"
        cancelLabel="البقاء"
      />

      <ConfirmSheet
        open={Boolean(deleteUserTarget)}
        onClose={() => !deletingUser && setDeleteUserTarget(null)}
        onConfirm={handleConfirmDeletePassword}
        loading={deletingUser}
        tone="danger"
        title="حذف الحساب"
        description={
          deleteUserTarget ? `حذف "${deleteUserTarget.display_name}" وإنهاء جلساته؟` : ''
        }
        confirmLabel="حذف"
      />

      <ConfirmSheet
        open={confirmRevokeSessions}
        onClose={() => !revokingSessions && setConfirmRevokeSessions(false)}
        onConfirm={handleConfirmRevokeAllSessions}
        loading={revokingSessions}
        tone="danger"
        title="إنهاء باقي الأجهزة"
        description="تسجيل خروج جميع الأجهزة الأخرى مع بقاء جهازك الحالي متصلاً؟"
        confirmLabel="إنهاء الجلسات"
      />

      <ConfirmSheet
        open={confirmClearAudit}
        onClose={() => !clearingAudit && setConfirmClearAudit(false)}
        onConfirm={handleConfirmClearAuditLogs}
        loading={clearingAudit}
        tone="danger"
        title="مسح السجل"
        description="أرشفة ومسح السجل الرقابي الحالي؟"
        confirmLabel="مسح"
      />
    </div>
  );
}
