import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest, clearMasterAuditLogs } from '../lib/api.js';
import {
  buildAuditLogsWhatsAppText,
  exportAuditLogsCsv,
  exportAuditLogsWord,
  formatTimeWithSeconds,
  openWhatsAppShare,
} from '../lib/exportUtils.js';

const AVATAR_COLORS = [
  '#7627BB',
  '#0B57D0',
  '#185ABC',
  '#146C2E',
  '#E37400',
  '#B3261E',
  '#007B83',
];

const QUICK_ROLE_PRESETS = [
  { role: 'cashier', label: 'الكاشير / الكاشيرية', color: '#E37400', icon: 'point_of_sale' },
  { role: 'hall', label: 'عمال الصالة (النواقص)', color: '#007B83', icon: 'shopping_basket' },
  { role: 'security', label: 'الأمن واستلام البضاعة', color: '#146C2E', icon: 'shield_person' },
  { role: 'cctv', label: 'مراقب الكاميرات', color: '#185ABC', icon: 'desktop_windows' },
  { role: 'supervisor', label: 'مشرف الصالة والفرع', color: '#0B57D0', icon: 'manage_accounts' },
  { role: 'warehouse', label: 'أمين المخزن والاستلام', color: '#007B83', icon: 'warehouse' },
  { role: 'delivery', label: 'الدليفري والتوصيل', color: '#146C2E', icon: 'two_wheeler' },
  { role: 'kiosk', label: 'شاشة كشك العمال', color: '#E37400', icon: 'touch_app' },
];

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

  // New Password + Role form
  const [newDisplayName, setNewDisplayName] = useState('كاشير الشفت');
  const [newRole, setNewRole] = useState('cashier');
  const [newPassword, setNewPassword] = useState('');
  const [newColor, setNewColor] = useState('#E37400');

  // Edit Password / Role / Custom Permissions modal
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('cashier');
  const [editPassword, setEditPassword] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editCustomPerms, setEditCustomPerms] = useState([]);

  // Role Matrix editor
  const [selectedMatrixRole, setSelectedMatrixRole] = useState('cashier');
  const [draftPerms, setDraftPerms] = useState([]);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Audit filter
  const [auditRoleFilter, setAuditRoleFilter] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');

  const loadRbac = useCallback(async () => {
    try {
      const res = await apiRequest('/api/rbac/overview');
      setOverview(res);
      setDraftPerms(res.policies?.[selectedMatrixRole] || []);
    } catch (err) {
      onToast?.(err.message || 'تعذر تحميل إدارة كلمات المرور والصلاحيات', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast, selectedMatrixRole]);

  useEffect(() => {
    loadRbac();
  }, [loadRbac]);

  function applyQuickPreset(preset) {
    setNewRole(preset.role);
    setNewDisplayName(preset.label);
    setNewColor(preset.color);
  }

  function toggleReveal(id) {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSelectMatrixRole(roleId) {
    setSelectedMatrixRole(roleId);
    setDraftPerms(overview.policies?.[roleId] || []);
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
      onToast?.('تم حفظ صلاحيات هذا الدور بنجاح ✓');
      await loadRbac();
      onRefreshParent?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleCreatePassword(e) {
    e.preventDefault();
    if (!newPassword.trim()) return;
    try {
      await apiRequest('/api/rbac/users', 'POST', {
        display_name: newDisplayName.trim(),
        role: newRole,
        password: newPassword.trim(),
        avatar_color: newColor,
      });
      setNewPassword('');
      onToast?.(`تم إنشاء كلمة المرور لـ "${newDisplayName.trim()}" بنجاح ✓`);
      await loadRbac();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  function openEditUserModal(u) {
    setEditingUser(u);
    setEditName(u.display_name);
    setEditRole(u.role);
    setEditPassword('');
    setEditActive(Boolean(u.is_active));
    setEditCustomPerms(Array.isArray(u.custom_permissions) ? u.custom_permissions : []);
  }

  function toggleUserCustomPerm(permId) {
    setEditCustomPerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  }

  async function handleSaveUserEdit(e) {
    e.preventDefault();
    if (!editingUser) return;
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
      onToast?.('تم تحديث كلمة المرور والصلاحيات المخصصة بنجاح ✓');
      await loadRbac();
      onRefreshParent?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeletePassword(u) {
    if (!window.confirm(`هل أنت متأكد من حذف كلمة مرور "${u.display_name}" وإلغاء دخول أي جهاز يستخدمها؟`)) {
      return;
    }
    try {
      await apiRequest(`/api/rbac/users/${u.id}`, 'DELETE');
      onToast?.('تم حذف كلمة المرور وإبطال جلساتها بنجاح ✓');
      await loadRbac();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleRevokeAllOtherSessions() {
    if (!window.confirm('هل تريد تسجيل خروج إجباري لجميع الأجهزة الأخرى المتصلة الآن؟')) {
      return;
    }
    try {
      const res = await apiRequest('/api/rbac/sessions/revoke-all', 'POST');
      onToast?.(`تم تسجيل خروج (${res.revokedCount}) جهاز آخر بنجاح ✓`);
      await loadRbac();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleClearAuditLogs() {
    if (!window.confirm('هل تريد أرشفة ومسح السجل الرقابي الحالي؟')) return;
    try {
      await clearMasterAuditLogs();
      onToast?.('تم مسح السجل الرقابي بنجاح ✓');
      await loadRbac();
    } catch (err) {
      onToast?.(err.message, 'error');
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

  if (loading) {
    return (
      <div className="g-card p-8 text-center text-sm font-bold text-[var(--g-muted)]">
        جاري تحميل لوحة إدارة كلمات المرور والصلاحيات والسجل الشامل...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Security Banner & Active Sessions Control */}
      <div className="g-card p-4 sm:p-5 bg-[var(--g-surface-tint)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#7627BB] text-white flex items-center justify-center shrink-0">
            <span className="ms-icon filled text-2xl">vpn_key</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold m-0">
              إدارة كلمات المرور، الأدوار، والصلاحيات المخصصة (RBAC)
            </h3>
            <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
              تحكم كامل للأدمن في كل مستخدم، كل دور، وكل صلاحية • أجهزة متصلة حالياً:{' '}
              <strong className="num-ltr text-[var(--g-primary)]">
                {overview.activeSessionsCount}
              </strong>
            </p>
          </div>
        </div>

        {canManageUsers && (
          <button
            type="button"
            onClick={handleRevokeAllOtherSessions}
            className="w-full sm:w-auto px-4 py-2.5 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0 hover:opacity-90"
          >
            <span className="ms-icon filled text-base">phonelink_erase</span>
            <span>تسجيل خروج باقي الأجهزة</span>
          </button>
        )}
      </div>

      {/* Section Switcher Pills */}
      <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
        {canManageUsers && (
          <>
            <button
              type="button"
              onClick={() => setSection('users')}
              className={`min-h-[44px] px-4 py-2 rounded-2xl sm:rounded-full text-xs sm:text-sm flex items-center justify-center gap-1.5 border active:scale-95 ${
                section === 'users'
                  ? 'g-pill-active border-transparent shadow-2xs'
                  : 'bg-[var(--g-surface)] border-[var(--g-border)] font-bold'
              }`}
            >
              <span className="ms-icon text-base">key</span>
              <span>كلمات المرور والمستخدمون ({overview.users?.length || 0})</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('matrix')}
              className={`min-h-[44px] px-4 py-2 rounded-2xl sm:rounded-full text-xs sm:text-sm flex items-center justify-center gap-1.5 border active:scale-95 ${
                section === 'matrix'
                  ? 'g-pill-active border-transparent shadow-2xs'
                  : 'bg-[var(--g-surface)] border-[var(--g-border)] font-bold'
              }`}
            >
              <span className="ms-icon text-base">tune</span>
              <span>تخصيص صلاحيات كل دور ({overview.permissionsCatalog?.length || 0} صلاحية)</span>
            </button>
          </>
        )}

        {canViewAudit && (
          <button
            type="button"
            onClick={() => setSection('audit')}
            className={`min-h-[44px] px-4 py-2 rounded-2xl sm:rounded-full text-xs sm:text-sm flex items-center justify-center gap-1.5 border active:scale-95 ${
              section === 'audit'
                ? 'g-pill-active border-transparent shadow-2xs'
                : 'bg-[var(--g-surface)] border-[var(--g-border)] font-bold'
            }`}
          >
            <span className="ms-icon text-base">policy</span>
            <span>السجل الرقابي الشامل للنظام ({overview.auditLogs?.length || 0})</span>
          </button>
        )}
      </div>

      {/* SECTION 1: CREATE & MANAGE ALL PASSWORDS */}
      {canManageUsers && section === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Create Password Form */}
          <form
            onSubmit={handleCreatePassword}
            className="lg:col-span-5 g-card p-4 sm:p-5 space-y-3.5 h-fit"
          >
            <h4 className="text-sm sm:text-base font-extrabold m-0 flex items-center gap-2">
              <span className="ms-icon filled text-[var(--g-primary)]">add_moderator</span>
              <span>إنشاء حساب / كلمة مرور جديدة بصلاحية محددة</span>
            </h4>

            {/* 1-Tap Role Presets */}
            <div>
              <span className="block text-[11px] font-bold text-[var(--g-muted)] mb-1.5">
                اختيار سريع لنوع الوظيفة (بما فيها الكاشير والمخزن والدليفري):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ROLE_PRESETS.map((p) => (
                  <button
                    key={p.role}
                    type="button"
                    onClick={() => applyQuickPreset(p)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 border transition-all ${
                      newRole === p.role
                        ? 'g-pill-active border-transparent'
                        : 'bg-[var(--g-surface-variant)] border-[var(--g-border)]'
                    }`}
                  >
                    <span className="ms-icon text-sm">{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                الدور الوظيفي (Role) الذي يفتحه النظام تلقائياً *
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="g-input w-full font-bold"
              >
                {Object.values(overview.rolesMeta || {}).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                الاسم الظاهر في السجلات والبروفايل *
              </label>
              <input
                type="text"
                required
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="مثال: كاشير شيفت صباحي - أحمد"
                className="g-input w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">
                كلمة المرور الخاصة به (يرى كل موظف باسورده فقط في بروفايله) *
              </label>
              <input
                type="text"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="مثال: 205 أو cash1"
                className="g-input w-full num-ltr text-lg font-extrabold"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full ${
                      newColor === c ? 'ring-2 ring-offset-2 ring-[#0B57D0]' : ''
                    }`}
                  />
                ))}
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5"
              >
                <span className="ms-icon text-base">add</span>
                <span>إنشاء الحساب وكلمة المرور</span>
              </button>
            </div>
          </form>

          {/* All Created Passwords List */}
          <div className="lg:col-span-7 g-card p-4 sm:p-5 space-y-3">
            <h4 className="text-sm sm:text-base font-extrabold m-0">
              جميع الحسابات وكلمات المرور الفعالة في زايد مارت ({overview.users?.length || 0})
            </h4>

            <div className="space-y-2.5">
              {(overview.users || []).map((u) => {
                const roleMeta = overview.rolesMeta?.[u.role] || { label: u.role, icon: 'person' };
                const isRevealed = Boolean(revealedIds[u.id]);
                const customCount = Array.isArray(u.custom_permissions)
                  ? u.custom_permissions.length
                  : 0;

                return (
                  <div
                    key={u.id}
                    className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      u.is_active
                        ? 'bg-[var(--g-surface-variant)]/45 border-[var(--g-border)]'
                        : 'opacity-60 bg-[var(--g-red-bg)]/20 border-[var(--g-border)]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        style={{ backgroundColor: u.avatar_color || '#0B57D0' }}
                        className="w-11 h-11 rounded-2xl text-white flex items-center justify-center shrink-0"
                      >
                        <span className="ms-icon filled text-xl">{roleMeta.icon || 'key'}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-extrabold text-sm sm:text-base truncate">
                            {u.display_name}
                          </span>
                          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] font-extrabold">
                            {roleMeta.shortLabel || roleMeta.label}
                          </span>
                          {customCount > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-purple-bg)] text-[var(--g-purple)] font-extrabold">
                              +{customCount} صلاحية إضافية
                            </span>
                          )}
                          {u.id === currentUserId && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] font-extrabold">
                              أنت الآن
                            </span>
                          )}
                          {!u.is_active && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] font-extrabold">
                              موقوفة
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                          <span className="text-[var(--g-muted)]">كلمة المرور:</span>
                          <span className="px-2.5 py-0.5 rounded-lg bg-[var(--g-surface)] border border-[var(--g-border)] font-extrabold num-ltr">
                            {isRevealed ? u.password_value || 'غير متاح' : '••••••'}
                          </span>
                          {u.password_value && (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleReveal(u.id)}
                                className="text-[var(--g-primary)] font-bold flex items-center"
                                title={isRevealed ? 'إخفاء' : 'إظهار كلمة المرور'}
                              >
                                <span className="ms-icon text-base">
                                  {isRevealed ? 'visibility_off' : 'visibility'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(u.password_value);
                                  onToast?.('تم نسخ كلمة المرور ✓');
                                }}
                                className="text-[var(--g-muted)] hover:text-[var(--g-primary)] flex items-center"
                                title="نسخ كلمة المرور"
                              >
                                <span className="ms-icon text-base">content_copy</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0 flex-wrap">
                      {onOpenPersonLog && (
                        <button
                          type="button"
                          onClick={() => onOpenPersonLog(u.id, u.display_name)}
                          className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-xs font-extrabold flex items-center gap-1"
                          title="عرض السجل الفردي الكامل"
                        >
                          <span className="ms-icon text-sm text-[var(--g-primary)]">assignment_ind</span>
                          <span>سجله</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditUserModal(u)}
                        className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-xs font-extrabold flex items-center gap-1"
                      >
                        <span className="ms-icon text-base text-[var(--g-primary)]">edit</span>
                        <span>تعديل وصلاحيات</span>
                      </button>

                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleDeletePassword(u)}
                          title="حذف كلمة المرور"
                          className="w-8 h-8 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center hover:opacity-90"
                        >
                          <span className="ms-icon text-base">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: DYNAMIC ROLE PERMISSIONS MATRIX */}
      {canManageUsers && section === 'matrix' && (
        <section className="g-card p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--g-border)] pb-3">
            <div>
              <h4 className="text-base font-extrabold m-0">
                تخصيص صلاحيات كل دور وظيفي (Dynamic RBAC Policy Matrix)
              </h4>
              <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
                تحكّم بدقة في الأزرار والبيانات المسموحة لكل وظيفة (الكاشير، الأمن، المراقب، المشرف، المخزن، الصالة)
              </p>
            </div>

            {selectedMatrixRole !== 'owner' && (
              <button
                type="button"
                disabled={savingPolicy}
                onClick={handleSaveRolePolicy}
                className="px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
              >
                <span className="ms-icon filled text-lg">save</span>
                <span>{savingPolicy ? 'جاري الحفظ...' : 'حفظ صلاحيات الدور ✓'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {Object.values(overview.rolesMeta || {}).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelectMatrixRole(r.id)}
                className={`px-4 py-2 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap border transition-all ${
                  selectedMatrixRole === r.id
                    ? 'bg-[var(--g-primary)] text-white border-[var(--g-primary)]'
                    : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] text-[var(--g-text)]'
                }`}
              >
                <span className="ms-icon text-base">{r.icon}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>

          {selectedMatrixRole === 'owner' && (
            <div className="p-3 rounded-2xl bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold">
              🔒 دور (المالك / المدير العام) يمتلك دائماً كافة الصلاحيات ({overview.permissionsCatalog?.length || 0} صلاحية) للتحكم الكامل بالنظام.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(groupedPermissions).map(([groupName, perms]) => (
              <div
                key={groupName}
                className="p-4 rounded-2xl bg-[var(--g-surface-variant)]/45 border border-[var(--g-border)] space-y-2.5"
              >
                <div className="text-xs font-extrabold text-[var(--g-primary)] border-b border-[var(--g-border)] pb-1.5">
                  {groupName}
                </div>
                {perms.map((perm) => {
                  const checked =
                    selectedMatrixRole === 'owner' || draftPerms.includes(perm.id);
                  return (
                    <label
                      key={perm.id}
                      className={`flex items-center justify-between gap-2 p-2 rounded-xl text-xs font-bold ${
                        selectedMatrixRole === 'owner'
                          ? 'opacity-80 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-[var(--g-surface)]'
                      }`}
                    >
                      <span>{perm.label}</span>
                      <input
                        type="checkbox"
                        disabled={selectedMatrixRole === 'owner'}
                        checked={checked}
                        onChange={() => toggleDraftPerm(perm.id)}
                        className="w-4 h-4 accent-[#0B57D0] shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SECTION 3: MASTER SYSTEM AUDIT LOG + MULTI-FORMAT EXPORT */}
      {canViewAudit && section === 'audit' && (
        <section className="g-card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--g-border)] pb-3">
            <div>
              <h4 className="text-base font-extrabold m-0">
                السجل الرقابي الشامل لكل حركات النظام ({filteredAuditLogs.length})
              </h4>
              <p className="text-xs text-[var(--g-muted)] m-0">
                يسجل كل حضور، انصراف، استراحة، نقص، ملاحظة، تعديل أو دخول في النظام مع التصدير لـ Excel و Word وواتساب
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => exportAuditLogsCsv(filteredAuditLogs)}
                className="px-3.5 py-2 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-xs font-extrabold flex items-center gap-1"
              >
                <span className="ms-icon text-sm">table_view</span>
                <span>تصدير Excel</span>
              </button>
              <button
                type="button"
                onClick={() => exportAuditLogsWord(filteredAuditLogs)}
                className="px-3.5 py-2 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold flex items-center gap-1"
              >
                <span className="ms-icon text-sm">description</span>
                <span>تصدير Word</span>
              </button>
              <button
                type="button"
                onClick={() => openWhatsAppShare(buildAuditLogsWhatsAppText(filteredAuditLogs))}
                className="px-3.5 py-2 rounded-full bg-[#25D366]/15 text-[#128C7E] dark:text-[#4ADE80] text-xs font-extrabold flex items-center gap-1"
              >
                <span className="ms-icon text-sm">share</span>
                <span>واتساب</span>
              </button>
              {canManageUsers && filteredAuditLogs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAuditLogs}
                  className="px-3 py-2 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center gap-1"
                >
                  <span className="ms-icon text-sm">delete_sweep</span>
                  <span>مسح السجل</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="g-search-bar flex-1 flex items-center gap-2 px-3.5 py-2">
              <span className="ms-icon text-[var(--g-muted)] text-lg">search</span>
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="ابحث في السجل بالاسم أو نوع العملية أو التفاصيل..."
                className="bg-transparent border-none outline-none w-full text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'all', label: 'كل الأدوار' },
                { id: 'owner', label: 'الإدارة' },
                { id: 'cashier', label: 'الكاشيرية' },
                { id: 'security', label: 'الأمن' },
                { id: 'supervisor', label: 'المشرفين' },
                { id: 'cctv', label: 'الكاميرات' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAuditRoleFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${
                    auditRoleFilter === f.id
                      ? 'g-pill-active border-transparent'
                      : 'bg-[var(--g-surface)] border-[var(--g-border)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredAuditLogs.length === 0 ? (
            <p className="text-center py-8 text-xs text-[var(--g-muted)]">
              لا توجد أحداث مطابقة في السجل الرقابي الشامل.
            </p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {filteredAuditLogs.map((log) => {
                const actorName = log.actor_name || log.user_name || 'النظام';
                const actorRole = log.actor_role || log.role || '';
                return (
                  <div
                    key={log.id}
                    className="p-3 rounded-2xl bg-[var(--g-surface-variant)]/50 border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full font-extrabold bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]">
                          {log.action}
                        </span>
                        <span className="text-xs font-extrabold">{actorName}</span>
                        {actorRole && (
                          <span className="text-[11px] text-[var(--g-muted)]">
                            ({overview.rolesMeta?.[actorRole]?.shortLabel || actorRole})
                          </span>
                        )}
                        {log.target_label && (
                          <span className="text-xs font-bold text-[var(--g-primary)]">
                            ← {log.target_label}
                          </span>
                        )}
                      </div>
                      {log.details && (
                        <div className="text-xs text-[var(--g-muted)]">{log.details}</div>
                      )}
                    </div>

                    <div className="text-[11px] text-[var(--g-muted)] flex items-center gap-2 self-end sm:self-auto shrink-0 num-ltr">
                      {log.ip_address && <span>IP: {log.ip_address}</span>}
                      <strong className="text-[var(--g-text)]">
                        {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG') : formatTimeWithSeconds(log.timestamp)}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Edit Password / Role / Custom Per-User Permissions Modal */}
      {editingUser && (
        <div onClick={() => setEditingUser(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveUserEdit}
            className="g-dialog-sheet max-w-xl space-y-4 animate-pop"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base font-extrabold m-0">
                تعديل الحساب والصلاحيات المخصصة: {editingUser.display_name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="w-8 h-8 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">الاسم الظاهر في السجلات</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="g-input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">الدور الوظيفي الأساسي (Role)</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="g-input w-full font-bold"
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
              <label className="block text-xs font-bold mb-1">
                تغيير كلمة المرور (اتركها فارغة للإبقاء على الحالية: {editingUser.password_value || '•••'})
              </label>
              <input
                type="text"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="اكتب كلمة المرور الجديدة هنا..."
                className="g-input w-full num-ltr text-lg font-extrabold"
              />
            </div>

            {/* Per-User Custom Extra Permissions */}
            {editRole !== 'owner' && (
              <div className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[var(--g-primary)]">
                    ⚡ صلاحيات إضافية خاصة بهذا المستخدم فقط (فوق صلاحيات دوره):
                  </span>
                  <span className="text-[11px] font-bold text-[var(--g-muted)]">
                    محدد: {editCustomPerms.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto p-1">
                  {(overview.permissionsCatalog || []).map((perm) => {
                    const roleHasIt = (overview.policies?.[editRole] || []).includes(perm.id);
                    const userHasExtra = editCustomPerms.includes(perm.id);
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-center justify-between gap-2 p-2 rounded-xl text-xs font-bold cursor-pointer ${
                          roleHasIt
                            ? 'bg-[var(--g-surface)]/60 opacity-75'
                            : userHasExtra
                              ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                              : 'bg-[var(--g-surface)]'
                        }`}
                      >
                        <span className="truncate">
                          {perm.label} {roleHasIt ? '(ضمن الدور)' : ''}
                        </span>
                        <input
                          type="checkbox"
                          checked={roleHasIt || userHasExtra}
                          disabled={roleHasIt}
                          onChange={() => toggleUserCustomPerm(perm.id)}
                          className="w-4 h-4 accent-[#0B57D0] shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 p-3 rounded-2xl bg-[var(--g-surface-variant)] text-xs font-extrabold cursor-pointer">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="w-4 h-4 accent-[#0B57D0]"
              />
              <span>الحساب مفعل ومسموح بالدخول به</span>
            </label>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
            >
              حفظ التعديلات والصلاحيات ✓
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
