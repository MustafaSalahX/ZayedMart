import React, { useMemo, useState } from 'react';
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
  SegmentedControl,
} from '../ui/index.js';
import {
  apiRequest,
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
  postActionWithOfflineSupport,
} from '../../lib/api.js';
import { ROLE_ARABIC_SHORT, ROLE_DEFAULT_COLORS } from '../../lib/navigation.js';

export const DEPARTMENTS_LIST = [
  'المدير',
  'مشرفين',
  'مراقب كاميرات',
  'أمن',
  'نظافة',
  'كاشير',
  'منسقي ممرات',
  'ثلاجات وأجبان',
  'مخزن',
  'دليفري',
];

export const EMPLOYEE_SYSTEM_ROLES = [
  { id: '', label: 'تلقائي حسب القسم' },
  { id: 'cashier', label: 'كاشير' },
  { id: 'manager', label: 'مدير الفرع' },
  { id: 'supervisor', label: 'مشرف الفرع' },
  { id: 'cctv', label: 'مراقب كاميرات' },
  { id: 'security', label: 'أمن وبوابة' },
  { id: 'hall', label: 'صالة ونواقص' },
  { id: 'warehouse', label: 'مخزن واستلام' },
  { id: 'delivery', label: 'دليفري' },
  { id: 'none', label: 'بدون دخول للنظام' },
  { id: 'kiosk', label: 'كشك الحضور' },
];

const SHIFT_PRESETS = [
  { label: '8س صباحي', start: '08:00', end: '16:00' },
  { label: '8س مسائي', start: '16:00', end: '00:00' },
  { label: '10س', start: '08:00', end: '18:00' },
  { label: '12س صباحي', start: '08:00', end: '20:00' },
  { label: '12س مسائي', start: '20:00', end: '08:00' },
];

const SWATCH_COLORS = Object.values(ROLE_DEFAULT_COLORS);

/**
 * Detoxed Staff Directory & Management Tab (`الموظفون`).
 * Zero outer-card-around-inner-cards bloat, zero stacked row badges,
 * inline muted metadata, and crisp BottomSheet composers.
 */
export default function DashboardStaffTab({
  employees = [],
  role = '',
  onOpenQrModal,
  onOpenPersonLog,
  onRefresh,
  onToast,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [entryMode, setEntryMode] = useState('single');
  const [empName, setEmpName] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [empDept, setEmpDept] = useState('كاشير');
  const [empRole, setEmpRole] = useState('');
  const [empSystemRole, setEmpSystemRole] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empShiftStart, setEmpShiftStart] = useState('08:00');
  const [empShiftEnd, setEmpShiftEnd] = useState('20:00');
  const [empColor, setEmpColor] = useState(SWATCH_COLORS[2] || 'var(--g-primary-solid)');
  const [empBulkLines, setEmpBulkLines] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const [editingEmployee, setEditingEmployee] = useState(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const deptChips = useMemo(() => {
    const counts = new Map();
    for (const e of employees) {
      const d = e.department || 'أخرى';
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    const items = [{ id: 'all', label: 'الكل', count: employees.length }];
    for (const [dept, count] of counts.entries()) {
      items.push({ id: dept, label: dept, count });
    }
    return items;
  }, [employees]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (deptFilter !== 'all' && e.department !== deptFilter) return false;
      if (q) {
        const hay = `${e.name} ${e.emp_code || ''} ${e.department} ${e.role_title || ''} ${e.phone || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, deptFilter, searchQuery]);

  async function handleAddSingle(e) {
    e?.preventDefault?.();
    if (!empName.trim() || submittingAdd) return;
    setSubmittingAdd(true);
    try {
      await postActionWithOfflineSupport('/api/employees', {
        emp_code: empCode.trim(),
        name: empName.trim(),
        department: empDept,
        role_title: empRole.trim(),
        system_role: empSystemRole,
        phone: empPhone.trim(),
        shift_start: empShiftStart,
        shift_end: empShiftEnd,
        avatar_color: empColor,
      });
      setEmpName('');
      setEmpCode('');
      setEmpRole('');
      setEmpSystemRole('');
      setEmpPhone('');
      setAddSheetOpen(false);
      onToast?.('تمت إضافة الموظف');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إضافة الموظف', 'error');
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function handleAddBulk(e) {
    e?.preventDefault?.();
    if (!empBulkLines.trim() || submittingAdd) return;
    setSubmittingAdd(true);
    try {
      const res = await apiRequest('/api/employees/bulk', 'POST', {
        lines: empBulkLines,
        department: empDept,
        system_role: empSystemRole,
        shift_start: empShiftStart,
        shift_end: empShiftEnd,
        avatar_color: empColor,
      });
      setEmpBulkLines('');
      setAddSheetOpen(false);
      onToast?.(`تمت إضافة ${res.addedCount} موظف`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إضافة القائمة', 'error');
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function handleSaveEditEmployee(e) {
    e?.preventDefault?.();
    if (!editingEmployee?.name?.trim() || submittingEdit) return;
    setSubmittingEdit(true);
    try {
      await apiRequest(`/api/employees/${editingEmployee.id}`, 'PUT', {
        name: editingEmployee.name.trim(),
        emp_code: String(editingEmployee.emp_code || '').trim(),
        login_password: String(
          editingEmployee.login_password ?? editingEmployee.emp_code ?? ''
        ).trim(),
        department: editingEmployee.department,
        role_title: editingEmployee.role_title || '',
        system_role: editingEmployee.system_role || '',
        phone: editingEmployee.phone || '',
        shift_start: editingEmployee.shift_start || '08:00',
        shift_end: editingEmployee.shift_end || '17:00',
        avatar_color: editingEmployee.avatar_color || SWATCH_COLORS[2],
      });
      setEditingEmployee(null);
      onToast?.('تم حفظ التعديلات');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حفظ التعديلات', 'error');
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleConfirmDeleteEmployee() {
    if (!deleteTarget || submittingDelete) return;
    setSubmittingDelete(true);
    try {
      await apiRequest(`/api/employees/${deleteTarget.id}`, 'DELETE');
      setDeleteTarget(null);
      onToast?.('تم حذف الموظف');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حذف الموظف', 'error');
    } finally {
      setSubmittingDelete(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <SectionHeader
          title="الموظفون"
          count={employees.length}
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              {employees.length > 0 && onOpenQrModal && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="qr_code_2"
                  onClick={() => onOpenQrModal('cards')}
                >
                  QR
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                icon="add"
                onClick={() => {
                  setEntryMode('single');
                  setAddSheetOpen(true);
                }}
              >
                إضافة
              </Button>
            </div>
          }
        />

        {employees.length > 0 && (
          <div className="space-y-2.5">
            <SearchFilterBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="بحث بالاسم أو الكود أو القسم..."
            />
            <FilterChipRail
              items={deptChips}
              activeId={deptFilter}
              onSelect={setDeptFilter}
            />
          </div>
        )}

        {filteredStaff.length === 0 ? (
          <EmptyState
            compact={employees.length > 0}
            title={employees.length === 0 ? 'لا يوجد موظفون' : 'لا توجد نتائج مطابقة'}
            actionLabel={employees.length === 0 ? 'إضافة موظف' : 'إعادة ضبط'}
            actionIcon={employees.length === 0 ? 'add' : 'restart_alt'}
            onAction={() => {
              if (employees.length === 0) {
                setAddSheetOpen(true);
              } else {
                setSearchQuery('');
                setDeptFilter('all');
              }
            }}
          />
        ) : (
          <GroupedList>
            {filteredStaff.map((emp) => {
              const roleLabel = emp.system_role
                ? ROLE_ARABIC_SHORT[emp.system_role] || emp.system_role
                : '';
              const metaParts = [
                emp.department,
                emp.role_title && emp.role_title !== emp.department ? emp.role_title : '',
                roleLabel && roleLabel !== emp.department ? roleLabel : '',
                `${emp.shift_start || '08:00'}–${emp.shift_end || '20:00'}`,
                role === 'owner' && (emp.login_password || emp.emp_code)
                  ? `#${emp.login_password || emp.emp_code}`
                  : '',
              ].filter(Boolean);

              return (
                <div
                  key={emp.id}
                  className="min-h-[56px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RoleAvatar
                      src={emp.avatar_url || ''}
                      name={emp.name}
                      role={emp.system_role || ''}
                      color={emp.avatar_color || ''}
                      preset="initials_gradient"
                      size="sm"
                      shape="circle"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink truncate">
                        {emp.name}
                      </div>
                      <div className="text-xs text-ink-muted truncate num-ltr">
                        {metaParts.join(' · ')}
                        {emp.phone ? ` · ${emp.phone}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="w-full sm:w-auto flex items-center justify-end gap-1 flex-wrap shrink-0">
                    {onOpenPersonLog && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenPersonLog(emp.id, emp.name)}
                      >
                        سجل
                      </Button>
                    )}

                    {emp.phone && (
                      <a
                        href={`tel:${emp.phone}`}
                        aria-label={`اتصال بـ ${emp.name}`}
                        title="اتصال"
                        className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center no-underline transition-[background-color,color] duration-150 shrink-0"
                      >
                        <Icon name="call" size={18} />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => setEditingEmployee({ ...emp })}
                      aria-label={`تعديل ${emp.name}`}
                      title="تعديل"
                      className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150 shrink-0"
                    >
                      <Icon name="edit" size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteTarget(emp)}
                      aria-label={`حذف ${emp.name}`}
                      title="حذف"
                      className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-danger-bg text-ink-muted hover:text-danger inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150 shrink-0"
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </div>

      {/* Add Single / Bulk Employee BottomSheet */}
      <BottomSheet
        open={addSheetOpen}
        onClose={() => !submittingAdd && setAddSheetOpen(false)}
        title="إضافة موظف"
        maxWidth="max-w-xl"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={submittingAdd}
              onClick={() => setAddSheetOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={submittingAdd}
              onClick={entryMode === 'single' ? handleAddSingle : handleAddBulk}
            >
              {entryMode === 'single' ? 'حفظ' : 'إضافة القائمة'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <SegmentedControl
            fullWidth
            value={entryMode}
            onChange={setEntryMode}
            options={[
              { id: 'single', label: 'موظف مفرد' },
              { id: 'bulk', label: 'قائمة جماعية' },
            ]}
          />

          {entryMode === 'single' ? (
            <form onSubmit={handleAddSingle} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    الاسم *
                  </label>
                  <input
                    type="text"
                    required
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    placeholder="أحمد محمد علي"
                    className="g-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    القسم
                  </label>
                  <select
                    value={empDept}
                    onChange={(e) => setEmpDept(e.target.value)}
                    className="g-input"
                  >
                    {DEPARTMENTS_LIST.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    المسمى
                  </label>
                  <input
                    type="text"
                    value={empRole}
                    onChange={(e) => setEmpRole(e.target.value)}
                    placeholder="كاشير أول"
                    className="g-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    الموبايل
                  </label>
                  <input
                    type="tel"
                    value={empPhone}
                    onChange={(e) => setEmpPhone(e.target.value)}
                    placeholder="010xxxxxxxx"
                    className="g-input num-ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    كود الدخول
                  </label>
                  <input
                    type="text"
                    value={empCode}
                    onChange={(e) => setEmpCode(e.target.value)}
                    placeholder="تلقائي"
                    className="g-input num-ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    الدور
                  </label>
                  <select
                    value={empSystemRole}
                    onChange={(e) => setEmpSystemRole(e.target.value)}
                    className="g-input"
                  >
                    {EMPLOYEE_SYSTEM_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-line">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span className="font-medium">الشفت</span>
                  <span className="num-ltr font-semibold text-ink">
                    {formatShiftDurationArabicClient(
                      computeShiftDurationHoursClient(empShiftStart, empShiftEnd)
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {SHIFT_PRESETS.map((preset) => {
                    const active =
                      empShiftStart === preset.start && empShiftEnd === preset.end;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setEmpShiftStart(preset.start);
                          setEmpShiftEnd(preset.end);
                        }}
                        className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded-[var(--g-radius-btn)] border text-xs font-medium inline-flex items-center gap-1 transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                          active
                            ? 'bg-primary-solid text-on-primary border-transparent'
                            : 'bg-transparent border-line text-ink hover:border-line-strong'
                        }`}
                      >
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      البداية
                    </label>
                    <input
                      type="time"
                      value={empShiftStart}
                      onChange={(e) => setEmpShiftStart(e.target.value)}
                      className="g-input num-ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      النهاية
                    </label>
                    <input
                      type="time"
                      value={empShiftEnd}
                      onChange={(e) => setEmpShiftEnd(e.target.value)}
                      className="g-input num-ltr"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-line">
                <span className="block text-xs font-medium text-ink-muted mb-1.5">
                  اللون
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {SWATCH_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEmpColor(c)}
                      aria-label={`اللون ${c}`}
                      className="w-11 h-11 rounded-full flex items-center justify-center bg-transparent hover:bg-surface-2 cursor-pointer"
                    >
                      <span
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full ${
                          empColor === c
                            ? 'ring-2 ring-offset-2 ring-[var(--g-primary)]'
                            : ''
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddBulk} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    القسم
                  </label>
                  <select
                    value={empDept}
                    onChange={(e) => setEmpDept(e.target.value)}
                    className="g-input"
                  >
                    {DEPARTMENTS_LIST.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      البداية
                    </label>
                    <input
                      type="time"
                      value={empShiftStart}
                      onChange={(e) => setEmpShiftStart(e.target.value)}
                      className="g-input num-ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      النهاية
                    </label>
                    <input
                      type="time"
                      value={empShiftEnd}
                      onChange={(e) => setEmpShiftEnd(e.target.value)}
                      className="g-input num-ltr"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الأسماء (سطر لكل موظف)
                </label>
                <textarea
                  rows={6}
                  required
                  value={empBulkLines}
                  onChange={(e) => setEmpBulkLines(e.target.value)}
                  placeholder={`أحمد محمد علي - كاشير - 01012345678\nمحمود حسن\nسارة خالد`}
                  className="g-input leading-relaxed"
                />
              </div>
            </form>
          )}
        </div>
      </BottomSheet>

      {/* Edit Employee BottomSheet */}
      <BottomSheet
        open={Boolean(editingEmployee)}
        onClose={() => !submittingEdit && setEditingEmployee(null)}
        title="تعديل موظف"
        subtitle={editingEmployee?.name || ''}
        maxWidth="max-w-xl"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={submittingEdit}
              onClick={() => setEditingEmployee(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={submittingEdit}
              onClick={handleSaveEditEmployee}
            >
              حفظ
            </Button>
          </div>
        }
      >
        {editingEmployee && (
          <form onSubmit={handleSaveEditEmployee} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الاسم *
                </label>
                <input
                  type="text"
                  required
                  value={editingEmployee.name}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, name: e.target.value }))
                  }
                  className="g-input"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  القسم
                </label>
                <select
                  value={editingEmployee.department}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, department: e.target.value }))
                  }
                  className="g-input"
                >
                  {DEPARTMENTS_LIST.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  المسمى
                </label>
                <input
                  type="text"
                  value={editingEmployee.role_title || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, role_title: e.target.value }))
                  }
                  className="g-input"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الموبايل
                </label>
                <input
                  type="tel"
                  value={editingEmployee.phone || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, phone: e.target.value }))
                  }
                  className="g-input num-ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  كود الدخول
                </label>
                <input
                  type="text"
                  value={editingEmployee.emp_code || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({
                      ...p,
                      emp_code: e.target.value,
                      login_password: e.target.value,
                    }))
                  }
                  className="g-input num-ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الدور
                </label>
                <select
                  value={editingEmployee.system_role || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, system_role: e.target.value }))
                  }
                  className="g-input"
                >
                  {EMPLOYEE_SYSTEM_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-line">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <span className="font-medium">الشفت</span>
                <span className="num-ltr font-semibold text-ink">
                  {formatShiftDurationArabicClient(
                    computeShiftDurationHoursClient(
                      editingEmployee.shift_start || '08:00',
                      editingEmployee.shift_end || '20:00'
                    )
                  )}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {SHIFT_PRESETS.map((preset) => {
                  const active =
                    editingEmployee.shift_start === preset.start &&
                    editingEmployee.shift_end === preset.end;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setEditingEmployee((p) => ({
                          ...p,
                          shift_start: preset.start,
                          shift_end: preset.end,
                        }))
                      }
                      className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded-[var(--g-radius-btn)] border text-xs font-medium transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                        active
                          ? 'bg-primary-solid text-on-primary border-transparent'
                          : 'bg-transparent border-line text-ink hover:border-line-strong'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    البداية
                  </label>
                  <input
                    type="time"
                    value={editingEmployee.shift_start || '08:00'}
                    onChange={(e) =>
                      setEditingEmployee((p) => ({ ...p, shift_start: e.target.value }))
                    }
                    className="g-input num-ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    النهاية
                  </label>
                  <input
                    type="time"
                    value={editingEmployee.shift_end || '17:00'}
                    onChange={(e) =>
                      setEditingEmployee((p) => ({ ...p, shift_end: e.target.value }))
                    }
                    className="g-input num-ltr"
                  />
                </div>
              </div>
            </div>
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        onClose={() => !submittingDelete && setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteEmployee}
        loading={submittingDelete}
        tone="danger"
        title="حذف الموظف"
        description={deleteTarget ? `حذف "${deleteTarget.name}" من القائمة النشطة؟` : ''}
        confirmLabel="حذف"
      />
    </>
  );
}
