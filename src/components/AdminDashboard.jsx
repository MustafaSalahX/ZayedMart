import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiRequest,
  postActionWithOfflineSupport,
  buildMagicCloudShareUrl,
  saveDirectCloudCredentials,
  hasPermission,
  formatRequestedQty,
} from '../lib/api.js';
import {
  exportDailyReportCsv,
  buildWhatsAppSummaryText,
  formatTimeWithSeconds,
} from '../lib/exportUtils.js';
import RbacSecurityPanel from './RbacSecurityPanel.jsx';
import AdminReportsPanel from './AdminReportsPanel.jsx';

const AVATAR_COLORS = [
  '#0B57D0',
  '#146C2E',
  '#E37400',
  '#B3261E',
  '#9334E6',
  '#007B83',
  '#185ABC',
  '#3C4043',
];

const DEPARTMENTS_LIST = [
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

const SUPPLIER_CATEGORIES = [
  'بقالة جافة',
  'ألبان وجبن',
  'مشروبات وعصائر',
  'شيبسي وسناكس',
  'مجمدات ولحوم',
  'خضار وفاكهة',
  'منظفات وورقيات',
  'مخبوزات وحلويات',
];

const EMPLOYEE_SYSTEM_ROLES = [
  { id: '', label: 'تحديد الرول تلقائياً حسب القسم (موصى به)' },
  { id: 'manager', label: 'المدير / مدير الفرع (manager)' },
  { id: 'supervisor', label: 'مشرف الفرع (supervisor)' },
  { id: 'cctv', label: 'مراقب الكاميرات (cctv)' },
  { id: 'security', label: 'أفراد الأمن والبوابة (security)' },
  { id: 'hall', label: 'عمال الصالة والنواقص (hall)' },
  { id: 'none', label: 'النظافة / بدون دخول للنظام (كرت حضور فقط)' },
  { id: 'kiosk', label: 'شاشة كشك حضور فقط (kiosk)' },
];

const ROLE_SHORT_LABELS = {
  owner: 'الأدمن العام',
  manager: 'المدير',
  supervisor: 'مشرف الفرع',
  cctv: 'مراقب كاميرات',
  security: 'الأمن',
  hall: 'عمال الصالة',
  kiosk: 'كشك الحضور',
  none: 'النظافة / حضور فقط',
};

export default function AdminDashboard({
  data,
  authUser,
  permissions = [],
  requestedSubTab = null,
  onClearRequestedSubTab,
  voiceConfirmEnabled,
  onToggleVoiceConfirm,
  onOpenQrModal,
  onRefresh,
  onToast,
  onPreviewImage,
}) {
  const role = authUser?.role || '';
  const canViewReports = hasPermission(permissions, role, 'reports:view');
  const canExportReports = hasPermission(permissions, role, 'reports:export');
  const canManageStaff = hasPermission(permissions, role, 'staff:manage');
  const canManageSuppliers = hasPermission(permissions, role, 'suppliers:manage');
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const canViewAudit = hasPermission(permissions, role, 'audit:view');
  const canManageSettings = hasPermission(permissions, role, 'settings:manage');
  const canManageBackup = hasPermission(permissions, role, 'backup:manage');
  const canManageRecords = hasPermission(permissions, role, 'records:manage');

  const availableSubTabs = useMemo(() => {
    const tabs = [];
    if (canViewReports) {
      tabs.push({
        id: 'reports',
        label: 'التقارير الشاملة',
        icon: 'analytics',
      });
    }
    if (canManageStaff || canManageSuppliers) {
      tabs.push({
        id: 'staff',
        label: 'الموظفون والموردون الحقيقيون',
        icon: 'group_add',
      });
    }
    if ((canManageUsers || canViewAudit) && data.connectionMode === 'local_server') {
      tabs.push({
        id: 'rbac',
        label: 'كلمات المرور والأدوار (RBAC)',
        icon: 'admin_panel_settings',
      });
    }
    if (canViewReports) {
      tabs.push({ id: 'timeline', label: 'السجل الزمني الموحد', icon: 'timeline' });
    }
    if (canManageSettings || canManageBackup) {
      tabs.push({
        id: 'sync',
        label: 'الشبكة والمزامنة والإعدادات',
        icon: 'cloud_sync',
      });
    }
    return tabs;
  }, [
    canViewReports,
    canManageStaff,
    canManageSuppliers,
    canManageUsers,
    canViewAudit,
    canManageSettings,
    canManageBackup,
    data.connectionMode,
  ]);

  const [subTab, setSubTab] = useState(() => {
    if ((data.employees?.length || 0) === 0 && (canManageStaff || canManageSuppliers)) {
      return 'staff';
    }
    return availableSubTabs[0]?.id || 'timeline';
  });

  useEffect(() => {
    if (requestedSubTab && availableSubTabs.some((t) => t.id === requestedSubTab)) {
      setSubTab(requestedSubTab);
      onClearRequestedSubTab?.();
    }
  }, [requestedSubTab, availableSubTabs, onClearRequestedSubTab]);

  const [networkInfo, setNetworkInfo] = useState({ ips: [], apiPort: 3001, schemaSql: '' });

  // Staff Entry Mode: 'single' | 'bulk'
  const [empEntryMode, setEmpEntryMode] = useState('single');
  const [empSearch, setEmpSearch] = useState('');
  const [empName, setEmpName] = useState('');
  const [empCode, setEmpCode] = useState('');
  const [empDept, setEmpDept] = useState('كاشير');
  const [empRole, setEmpRole] = useState('');
  const [empSystemRole, setEmpSystemRole] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empShiftStart, setEmpShiftStart] = useState('08:00');
  const [empShiftEnd, setEmpShiftEnd] = useState('17:00');
  const [empColor, setEmpColor] = useState('#0B57D0');
  const [empBulkLines, setEmpBulkLines] = useState('');
  const [editingEmployee, setEditingEmployee] = useState(null);

  // Supplier Entry Mode: 'single' | 'bulk'
  const [supEntryMode, setSupEntryMode] = useState('single');
  const [supSearch, setSupSearch] = useState('');
  const [supName, setSupName] = useState('');
  const [supCategory, setSupCategory] = useState('بقالة جافة');
  const [supPhone, setSupPhone] = useState('');
  const [supColor, setSupColor] = useState('#0B57D0');
  const [supHasReturn, setSupHasReturn] = useState(false);
  const [supReturnNote, setSupReturnNote] = useState('');
  const [supBulkLines, setSupBulkLines] = useState('');
  const [editingSupplier, setEditingSupplier] = useState(null);

  // Settings & Cloud Sync form
  const [storeName, setStoreName] = useState(data.settings?.store_name || 'زايد مارت');
  const [branchName, setBranchName] = useState(data.settings?.branch_name || 'الفرع الرئيسي');
  const [newAdminPin, setNewAdminPin] = useState('');
  const [maxBreak, setMaxBreak] = useState(data.settings?.max_break_minutes || 30);
  const [maxUnload, setMaxUnload] = useState(data.settings?.max_unload_minutes || 60);
  const [supabaseUrl, setSupabaseUrl] = useState(data.settings?.supabase_url || '');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [cloudEnabled, setCloudEnabled] = useState(
    Boolean(data.settings?.cloud_sync_enabled)
  );
  const [cloudStatusMsg, setCloudStatusMsg] = useState('');
  const [syncing, setSyncing] = useState(false);

  const backupInputRef = useRef(null);

  useEffect(() => {
    setStoreName(data.settings?.store_name || 'زايد مارت');
    setBranchName(data.settings?.branch_name || 'الفرع الرئيسي');
    setMaxBreak(data.settings?.max_break_minutes || 30);
    setMaxUnload(data.settings?.max_unload_minutes || 60);
    setSupabaseUrl(data.settings?.supabase_url || '');
    setCloudEnabled(Boolean(data.settings?.cloud_sync_enabled));
  }, [data.settings]);

  useEffect(() => {
    if (availableSubTabs.length > 0 && !availableSubTabs.some((t) => t.id === subTab)) {
      setSubTab(availableSubTabs[0].id);
    }
  }, [availableSubTabs, subTab]);

  useEffect(() => {
    if (canManageSettings && data.connectionMode === 'local_server') {
      apiRequest('/api/system/network')
        .then((res) => setNetworkInfo(res))
        .catch(() => {});
    }
  }, [canManageSettings, data.connectionMode]);

  const timelineItems = useMemo(() => {
    const items = [];
    const actionMap = {
      check_in: 'حضور موظف',
      break_start: 'بداية استراحة',
      break_end: 'عودة من استراحة',
      check_out: 'انصراف موظف',
    };

    for (const a of data.attendanceLogs || []) {
      items.push({
        id: `att_${a.id}`,
        deleteEndpoint: `/api/attendance/${a.id}`,
        time: a.timestamp,
        icon: 'badge',
        tone: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
        title: `${actionMap[a.action_type] || a.action_type}: ${a.employee_name}`,
        subtitle: `${a.department} • بواسطة: ${a.recorded_by}${
          a.late_minutes > 0 ? ` • تأخير ${a.late_minutes} د` : ''
        }${a.note ? ` • "${a.note}"` : ''}`,
        proof: a.proof_url,
      });
    }

    for (const t of data.truckLogs || []) {
      items.push({
        id: `trk_${t.id}`,
        deleteEndpoint: `/api/trucks/${t.id}`,
        time: t.departure_time || t.arrival_time,
        icon: 'local_shipping',
        tone:
          t.delivery_condition === 'return_damaged'
            ? 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
            : t.delivery_condition === 'shortage'
            ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
            : 'bg-[var(--g-green-bg)] text-[var(--g-green)]',
        title: `عربية مورد: ${t.supplier_name} (${
          t.status === 'unloading' ? 'قيد التنزيل' : 'تم الاستلام'
        })`,
        subtitle: `${t.category}${
          t.duration_minutes ? ` • ${t.duration_minutes} د` : ''
        } • ${t.recorded_by}${t.notes ? ` • ${t.notes}` : ''}`,
        proof: t.completion_proof_url || t.arrival_proof_url,
      });
    }

    for (const sh of data.shortages || []) {
      items.push({
        id: `sht_${sh.id}`,
        deleteEndpoint: `/api/shortages/${sh.id}`,
        time: sh.updated_at || sh.created_at,
        icon: 'shopping_basket',
        tone:
          sh.status === 'resolved'
            ? 'bg-[var(--g-green-bg)] text-[var(--g-green)]'
            : 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
        title: `نواقص الصالة: ${sh.item_name} (${formatRequestedQty(sh.requested_qty, sh.unit)})`,
        subtitle: `${sh.category} • سجله: ${sh.recorded_by}${sh.notes ? ` • ${sh.notes}` : ''}`,
        proof: '',
      });
    }

    for (const n of data.notes || []) {
      items.push({
        id: `not_${n.id}`,
        deleteEndpoint: `/api/notes/${n.id}`,
        time: n.timestamp,
        icon: 'sticky_note_2',
        tone:
          n.severity === 'urgent'
            ? 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
            : 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
        title: `ملاحظة [${n.dvr_timestamp}] — ${n.location_tag}`,
        subtitle: `${n.category_tag}: ${n.content} (${n.recorded_by})`,
        proof: n.proof_url,
      });
    }

    return items.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [data]);

  const filteredStaff = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    const list = data.employees || [];
    if (!q) return list;
    return list.filter((e) =>
      `${e.name} ${e.emp_code || ''} ${e.department} ${e.role_title || ''} ${e.phone || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [data.employees, empSearch]);

  const filteredSuppliers = useMemo(() => {
    const q = supSearch.trim().toLowerCase();
    const list = data.suppliers || [];
    if (!q) return list;
    return list.filter((s) =>
      `${s.name} ${s.category} ${s.phone || ''}`.toLowerCase().includes(q)
    );
  }, [data.suppliers, supSearch]);

  function handleShareWhatsApp() {
    const text = buildWhatsAppSummaryText(data);
    navigator.clipboard?.writeText(text).catch(() => {});
    onToast?.('تم نسخ ملخص اليوم المنسق لواتساب!');
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyWhatsAppOnly() {
    const text = buildWhatsAppSummaryText(data);
    try {
      await navigator.clipboard.writeText(text);
      onToast?.('تم نسخ التقرير اليومي المنسق للحافظة ✓');
    } catch {
      onToast?.('تعذر النسخ التلقائي', 'error');
    }
  }

  async function handleAddEmployee(e) {
    e.preventDefault();
    if (!empName.trim()) return;
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
      onToast?.('تمت إضافة الموظف وتفعيل باسورد الدخول وكرت الـ QR له ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleBulkAddEmployees(e) {
    e.preventDefault();
    if (!empBulkLines.trim()) return;
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
      onToast?.(`تمت إضافة (${res.addedCount}) موظف بأكواد وكروت QR تلقائية ✓`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSaveEditEmployee(e) {
    e.preventDefault();
    if (!editingEmployee?.name?.trim()) return;
    try {
      await apiRequest(`/api/employees/${editingEmployee.id}`, 'PUT', {
        name: editingEmployee.name.trim(),
        emp_code: String(editingEmployee.emp_code || '').trim(),
        login_password: String(editingEmployee.login_password ?? editingEmployee.emp_code ?? '').trim(),
        department: editingEmployee.department,
        role_title: editingEmployee.role_title || '',
        system_role: editingEmployee.system_role || '',
        phone: editingEmployee.phone || '',
        shift_start: editingEmployee.shift_start || '08:00',
        shift_end: editingEmployee.shift_end || '17:00',
        avatar_color: editingEmployee.avatar_color || '#0B57D0',
      });
      setEditingEmployee(null);
      onToast?.('تم تحديث بيانات الموظف وباسورد الدخول بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeleteEmployee(id, name) {
    if (!window.confirm(`هل أنت متأكد من حذف/أرشفة الموظف "${name}"؟`)) return;
    try {
      await apiRequest(`/api/employees/${id}`, 'DELETE');
      onToast?.('تم حذف الموظف من القائمة النشطة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleAddSupplier(e) {
    e.preventDefault();
    if (!supName.trim()) return;
    try {
      await apiRequest('/api/suppliers', 'POST', {
        name: supName.trim(),
        category: supCategory,
        phone: supPhone.trim(),
        color: supColor,
        has_pending_return: supHasReturn ? 1 : 0,
        pending_return_note: supHasReturn ? supReturnNote.trim() : '',
      });
      setSupName('');
      setSupPhone('');
      setSupHasReturn(false);
      setSupReturnNote('');
      onToast?.('تمت إضافة المورد بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleBulkAddSuppliers(e) {
    e.preventDefault();
    if (!supBulkLines.trim()) return;
    try {
      const res = await apiRequest('/api/suppliers/bulk', 'POST', {
        lines: supBulkLines,
        category: supCategory,
        color: supColor,
      });
      setSupBulkLines('');
      onToast?.(`تمت إضافة (${res.addedCount}) شركة/مورد للكروت السريعة ✓`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSaveEditSupplier(e) {
    e.preventDefault();
    if (!editingSupplier?.name?.trim()) return;
    try {
      await apiRequest(`/api/suppliers/${editingSupplier.id}`, 'PUT', {
        name: editingSupplier.name.trim(),
        category: editingSupplier.category,
        phone: editingSupplier.phone || '',
        color: editingSupplier.color || '#0B57D0',
        has_pending_return: editingSupplier.has_pending_return ? 1 : 0,
        pending_return_note: editingSupplier.has_pending_return
          ? editingSupplier.pending_return_note || ''
          : '',
      });
      setEditingSupplier(null);
      onToast?.('تم تحديث بيانات المورد بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeleteSupplier(id, name) {
    if (!window.confirm(`حذف المورد "${name}" من الكروت السريعة؟`)) return;
    try {
      await apiRequest(`/api/suppliers/${id}`, 'DELETE');
      onToast?.('تم حذف المورد');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleClearOperationalLogs() {
    if (
      !window.confirm(
        'سيتم مسح سجلات الحركات التجريبية فقط (الحضور والعربيات والملاحظات)، مع الاحتفاظ الكامل بجميع الموظفين والموردين الحقيقيين وكلمات المرور. هل تريد المتابعة؟'
      )
    ) {
      return;
    }
    try {
      await apiRequest('/api/system/clear-logs', 'POST');
      onToast?.('تم تصفير سجلات التجربة بنجاح مع بقاء الموظفين والموردين ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      const payload = {
        store_name: storeName.trim() || 'زايد مارت',
        branch_name: branchName.trim() || 'الفرع الرئيسي',
        max_break_minutes: Number(maxBreak) || 30,
        max_unload_minutes: Number(maxUnload) || 60,
        supabase_url: supabaseUrl.trim(),
        supabase_anon_key: supabaseKey.trim() ? supabaseKey.trim() : '***KEEP***',
        cloud_sync_enabled: cloudEnabled ? 'true' : 'false',
      };
      if (newAdminPin.trim()) {
        payload.admin_pin = newAdminPin.trim();
      }

      if (data.connectionMode === 'local_server') {
        await apiRequest('/api/settings', 'PUT', payload);
      } else if (supabaseUrl.trim() && supabaseKey.trim()) {
        saveDirectCloudCredentials({
          url: supabaseUrl.trim(),
          anonKey: supabaseKey.trim(),
          storeName: storeName.trim() || 'زايد مارت',
        });
      }

      setNewAdminPin('');
      onToast?.('تم حفظ الإعدادات بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleTestCloud() {
    setSyncing(true);
    setCloudStatusMsg('');
    try {
      const res = await apiRequest('/api/cloud/test', 'POST', {
        supabase_url: supabaseUrl.trim(),
        supabase_anon_key: supabaseKey.trim() || '***KEEP***',
      });
      setCloudStatusMsg(res.message);
      onToast?.(res.message, res.ok ? 'success' : 'error');
    } catch (err) {
      setCloudStatusMsg(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncCloudNow() {
    setSyncing(true);
    setCloudStatusMsg('');
    try {
      const res = await apiRequest('/api/cloud/sync', 'POST');
      setCloudStatusMsg(res.message);
      onToast?.(res.message, res.ok ? 'success' : 'error');
      onRefresh?.();
    } catch (err) {
      setCloudStatusMsg(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownloadBackup() {
    try {
      const backup = await apiRequest('/api/backup/export');
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zayed_mart_backup_${data.dateKey}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast?.('تم تحميل ملف النسخة الاحتياطية الكاملة ✓');
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleImportBackup(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await apiRequest('/api/backup/import', 'POST', json);
      onToast?.(res.message || 'تمت الاستعادة بنجاح');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'ملف النسخة الاحتياطية غير صالح', 'error');
    }
  }

  const s = data.summary || {};
  const isCleanOnboarding =
    (canManageStaff || canManageSuppliers) &&
    ((data.employees?.length || 0) === 0 || (data.suppliers?.length || 0) === 0);

  return (
    <div className="space-y-5">
      {/* Real Data & Password Quick Onboarding Banner */}
      {isCleanOnboarding && (
        <div className="g-card p-4 sm:p-5 border-2 border-[var(--g-primary)]/40 bg-[var(--g-primary-container)]/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--g-primary)] text-white flex items-center justify-center shrink-0">
              <span className="ms-icon filled text-2xl">rocket_launch</span>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold m-0">
                النظام نظيف تماماً وجاهز لإدخال بيانات زايد مارت الحقيقية
              </h3>
              <p className="text-xs text-[var(--g-muted)] m-0 mt-1 leading-relaxed">
                أضف موظفي الماركت ومورديك الحقيقيين (فردياً أو بلصق قائمة كاملة في ثوانٍ)، وأنشئ كلمات مرور مستقلة لمراقب الكاميرات والأمن وكشك العمال.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
            <button
              type="button"
              onClick={() => setSubTab('staff')}
              className={`w-full sm:w-auto px-3.5 py-2.5 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 ${
                subTab === 'staff'
                  ? 'bg-[var(--g-primary)] text-white'
                  : 'bg-[var(--g-surface)] border border-[var(--g-border)]'
              }`}
            >
              <span className="ms-icon text-base">group_add</span>
              <span>إدخال الموظفين والموردين</span>
            </button>
            {canManageUsers && data.connectionMode === 'local_server' && (
              <button
                type="button"
                onClick={() => setSubTab('rbac')}
                className={`w-full sm:w-auto px-3.5 py-2.5 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 ${
                  subTab === 'rbac'
                    ? 'bg-[var(--g-primary)] text-white'
                    : 'bg-[var(--g-surface)] border border-[var(--g-border)]'
                }`}
              >
                <span className="ms-icon text-base">key</span>
                <span>إدارة كلمات المرور والأدوار</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI Cards + Instant Export Actions */}
      <div className="g-card p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-xl font-extrabold m-0">
              ملخص تشغيل {data.settings?.store_name || 'زايد مارت'} — {data.dateKey}
            </h2>
            <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
              تقرير موحد لحضور الموظفين، عربيات الموردين، وملاحظات المراقبة
            </p>
          </div>

          {canExportReports && (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportDailyReportCsv(data)}
                className="px-3.5 py-2 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-xs font-extrabold flex items-center justify-center gap-1"
              >
                <span className="ms-icon text-base">table_view</span>
                <span>شيت Excel</span>
              </button>

              <button
                type="button"
                onClick={handleCopyWhatsAppOnly}
                className="px-3.5 py-2 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-bold flex items-center justify-center gap-1"
              >
                <span className="ms-icon text-base">content_copy</span>
                <span>نسخ التقرير</span>
              </button>

              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="col-span-2 sm:col-span-1 px-4 py-2 rounded-full bg-[#146C2E] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <span className="ms-icon text-base">send</span>
                <span>إرسال ملخص واتساب</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5">
          {[
            { label: 'حاضر الآن', val: s.presentCount || 0, tone: 'text-[var(--g-green)]' },
            { label: 'في استراحة', val: s.onBreakCount || 0, tone: 'text-[var(--g-yellow)]' },
            { label: 'حالات تأخير', val: s.lateCount || 0, tone: 'text-[var(--g-yellow)]' },
            { label: 'نواقص الصالة', val: s.openShortagesCount || 0, tone: 'text-[var(--g-red)]' },
            { label: 'عربيات مستلمة', val: s.completedTrucksCount || 0, tone: 'text-[var(--g-primary)]' },
            { label: 'نواقص ومرتجعات', val: s.issuesTrucksCount || 0, tone: 'text-[var(--g-red)]' },
            { label: 'ملاحظات طارئة', val: s.urgentNotesCount || 0, tone: 'text-[var(--g-red)]' },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-2xl bg-[var(--g-surface-variant)]/70 border border-[var(--g-border)] text-center"
            >
              <div className={`text-xl sm:text-2xl font-extrabold num-ltr ${item.tone}`}>
                {item.val}
              </div>
              <div className="text-[11px] sm:text-xs text-[var(--g-muted)] font-semibold mt-0.5">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sub-navigation for RBAC-permitted Admin/Supervisor/CCTV tabs — 2-col grid on mobile so nothing is hidden! */}
      {availableSubTabs.length > 1 && (
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 pb-0.5">
          {availableSubTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`min-h-[46px] px-3.5 py-2 rounded-2xl sm:rounded-full text-xs sm:text-sm flex items-center justify-center gap-1.5 border transition-all active:scale-95 ${
                subTab === t.id
                  ? 'g-pill-active border-transparent shadow-2xs'
                  : 'bg-[var(--g-surface)] border-[var(--g-border)] font-bold'
              }`}
            >
              <span className="ms-icon text-base sm:text-lg shrink-0">{t.icon}</span>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* SubTab: Comprehensive Multi-Day Reports */}
      {subTab === 'reports' && canViewReports && (
        <AdminReportsPanel
          data={data}
          canExportReports={canExportReports}
          onToast={onToast}
        />
      )}

      {/* SubTab: RBAC & Password Manager */}
      {subTab === 'rbac' && (canManageUsers || canViewAudit) && (
        <RbacSecurityPanel
          canManageUsers={canManageUsers}
          canViewAudit={canViewAudit}
          currentUserId={authUser?.id}
          onRefreshParent={onRefresh}
          onToast={onToast}
        />
      )}

      {/* SubTab: Unified Timeline */}
      {subTab === 'timeline' && canViewReports && (
        <section className="g-card p-4 sm:p-5">
          <h3 className="text-base sm:text-lg font-extrabold m-0 mb-4 flex items-center gap-2">
            <span className="ms-icon filled text-[var(--g-primary)]">schedule</span>
            <span>السجل الزمني الكامل لأحداث اليوم ({timelineItems.length})</span>
          </h3>

          {timelineItems.length === 0 ? (
            <p className="text-center py-8 text-sm text-[var(--g-muted)]">
              لا توجد حركات مسجلة في هذا اليوم حتى الآن.
            </p>
          ) : (
            <div className="space-y-2.5">
              {timelineItems.map((it) => (
                <div
                  key={it.id}
                  className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)]/50 border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${it.tone}`}
                    >
                      <span className="ms-icon filled text-xl">{it.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm sm:text-base">{it.title}</div>
                      <div className="text-xs text-[var(--g-muted)] mt-0.5">{it.subtitle}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {it.proof && (
                      <button
                        type="button"
                        onClick={() => onPreviewImage?.(it.proof, it.title)}
                        className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1"
                      >
                        <span className="ms-icon text-base text-[var(--g-primary)]">image</span>
                        <span>الصورة</span>
                      </button>
                    )}
                    <span className="num-ltr text-xs font-extrabold px-2.5 py-1 rounded-lg bg-[var(--g-surface)] border border-[var(--g-border)]">
                      {formatTimeWithSeconds(it.time)}
                    </span>
                    {canManageRecords && it.deleteEndpoint && data.connectionMode === 'local_server' && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`حذف هذا السجل نهائياً؟\n${it.title}`)) return;
                          try {
                            await apiRequest(it.deleteEndpoint, 'DELETE');
                            onToast?.('تم حذف السجل بنجاح');
                            onRefresh?.();
                          } catch (err) {
                            onToast?.(err.message, 'error');
                          }
                        }}
                        className="w-8 h-8 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center hover:opacity-90"
                        title="حذف السجل (أدمن)"
                      >
                        <span className="ms-icon text-base">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SubTab: Real Data Entry — Staff, QR Cards & Suppliers */}
      {(canManageStaff || canManageSuppliers) && subTab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {canManageStaff && (
            <section className="g-card p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-extrabold m-0 flex items-center gap-2">
                  <span className="ms-icon filled text-[var(--g-primary)]">person_add</span>
                  <span>موظفو زايد مارت ({data.employees?.length || 0})</span>
                </h3>
                {(data.employees?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenQrModal?.('cards')}
                    className="px-3 py-1.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold flex items-center gap-1"
                  >
                    <span className="ms-icon text-sm">print</span>
                    <span>طباعة كروت QR</span>
                  </button>
                )}
              </div>

              {/* Single vs Bulk Entry Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <button
                  type="button"
                  onClick={() => setEmpEntryMode('single')}
                  className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-all leading-tight ${
                    empEntryMode === 'single'
                      ? 'bg-[var(--g-surface)] text-[var(--g-primary)] shadow-2xs'
                      : 'text-[var(--g-muted)]'
                  }`}
                >
                  + إضافة موظف مفرد
                </button>
                <button
                  type="button"
                  onClick={() => setEmpEntryMode('bulk')}
                  className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-all leading-tight ${
                    empEntryMode === 'bulk'
                      ? 'bg-[var(--g-surface)] text-[var(--g-primary)] shadow-2xs'
                      : 'text-[var(--g-muted)]'
                  }`}
                >
                  ⚡ لصق قائمة جماعية
                </button>
              </div>

              {empEntryMode === 'single' ? (
                <form
                  onSubmit={handleAddEmployee}
                  className="space-y-3 bg-[var(--g-surface-variant)]/50 p-3.5 rounded-2xl border border-[var(--g-border)]"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={empName}
                      onChange={(e) => setEmpName(e.target.value)}
                      placeholder="اسم الموظف الثلاثي *"
                      className="g-input"
                    />
                    <select
                      value={empDept}
                      onChange={(e) => setEmpDept(e.target.value)}
                      className="g-input"
                    >
                      {DEPARTMENTS_LIST.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={empRole}
                      onChange={(e) => setEmpRole(e.target.value)}
                      placeholder="المسمى الوظيفي (اختياري مثل: كاشير أول)"
                      className="g-input"
                    />
                    <input
                      type="tel"
                      value={empPhone}
                      onChange={(e) => setEmpPhone(e.target.value)}
                      placeholder="رقم الموبايل (اختياري)"
                      className="g-input num-ltr"
                    />
                    <input
                      type="text"
                      value={empCode}
                      onChange={(e) => setEmpCode(e.target.value)}
                      placeholder="كود الموظف / باسورد الدخول الشخصي (مثل 233)"
                      className="g-input num-ltr"
                    />
                    <select
                      value={empSystemRole}
                      onChange={(e) => setEmpSystemRole(e.target.value)}
                      className="g-input sm:col-span-2 text-xs sm:text-sm font-bold"
                    >
                      {EMPLOYEE_SYSTEM_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          صلاحية الدخول: {r.label}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-[var(--g-muted)] mb-0.5">
                          بداية الشفت
                        </label>
                        <input
                          type="time"
                          value={empShiftStart}
                          onChange={(e) => setEmpShiftStart(e.target.value)}
                          className="g-input w-full num-ltr text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[var(--g-muted)] mb-0.5">
                          نهاية الشفت
                        </label>
                        <input
                          type="time"
                          value={empShiftEnd}
                          onChange={(e) => setEmpShiftEnd(e.target.value)}
                          className="g-input w-full num-ltr text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEmpColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-6 h-6 rounded-full ${
                            empColor === c ? 'ring-2 ring-offset-2 ring-[#0B57D0]' : ''
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center"
                    >
                      + حفظ وإضافة الموظف
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={handleBulkAddEmployees}
                  className="space-y-3 bg-[var(--g-surface-variant)]/50 p-3.5 rounded-2xl border border-[var(--g-border)]"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold mb-1">القسم لهذه المجموعة</label>
                      <select
                        value={empDept}
                        onChange={(e) => setEmpDept(e.target.value)}
                        className="g-input w-full"
                      >
                        {DEPARTMENTS_LIST.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold mb-1">من</label>
                        <input
                          type="time"
                          value={empShiftStart}
                          onChange={(e) => setEmpShiftStart(e.target.value)}
                          className="g-input w-full num-ltr text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">إلى</label>
                        <input
                          type="time"
                          value={empShiftEnd}
                          onChange={(e) => setEmpShiftEnd(e.target.value)}
                          className="g-input w-full num-ltr text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold mb-1">
                      اكتب أو الصق كل موظف في سطر مستقل:
                    </label>
                    <textarea
                      rows={5}
                      required
                      value={empBulkLines}
                      onChange={(e) => setEmpBulkLines(e.target.value)}
                      placeholder={`مثال (الاسم فقط أو الاسم - الوظيفة - الموبايل):\nأحمد محمد علي - كاشير صباحي - 01012345678\nمحمود حسن إبراهيم - كاشير مسائي\nسارة خالد`}
                      className="g-input w-full text-xs leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold"
                    >
                      + إضافة جميع الأسماء دفعة واحدة
                    </button>
                  </div>
                </form>
              )}

              {(data.employees?.length || 0) > 4 && (
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="ابحث داخل الموظفين المضافين..."
                  className="g-input w-full text-xs"
                />
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredStaff.length === 0 ? (
                  <p className="text-center py-6 text-xs text-[var(--g-muted)] m-0">
                    لا يوجد موظفون مضافون حالياً — ابدأ بإضافة موظفي زايد مارت بالأعلى.
                  </p>
                ) : (
                  filteredStaff.map((emp) => (
                    <div
                      key={emp.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-[var(--g-border)] text-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                          className="w-9 h-9 rounded-xl text-white font-extrabold flex items-center justify-center text-xs shrink-0"
                        >
                          {emp.name[0]}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold flex flex-wrap items-center gap-1.5">
                            <span className="truncate">{emp.name}</span>
                            <span className="num-ltr text-[11px] px-1.5 py-0.5 rounded bg-[var(--g-surface-variant)] text-[var(--g-primary)] font-extrabold">
                              باسورد/كود #{emp.login_password || emp.emp_code}
                            </span>
                            {emp.system_role && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-primary-container)] text-[var(--g-primary)] font-extrabold">
                                {ROLE_SHORT_LABELS[emp.system_role] || emp.system_role}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--g-muted)] truncate">
                            {emp.department}
                            {emp.role_title ? ` • ${emp.role_title}` : ''} • الشفت{' '}
                            <span className="num-ltr">
                              {emp.shift_start} - {emp.shift_end || '17:00'}
                            </span>
                            {emp.phone ? ` • ${emp.phone}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {emp.phone && (
                          <a
                            href={`tel:${emp.phone}`}
                            className="px-2.5 py-1 rounded-full bg-[var(--g-primary-container)] text-[var(--g-primary)] text-xs font-extrabold flex items-center gap-1 no-underline"
                            title={`اتصال مباشر بـ ${emp.name}`}
                          >
                            <span className="ms-icon filled text-sm">call</span>
                            <span className="hidden sm:inline">اتصال</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingEmployee({ ...emp })}
                          className="text-[var(--g-primary)] p-1.5 rounded-full hover:bg-[var(--g-primary-container)]"
                          title="تعديل بيانات الموظف"
                        >
                          <span className="ms-icon text-lg">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                          className="text-[var(--g-red)] p-1.5 rounded-full hover:bg-[var(--g-red-bg)]"
                          title="حذف الموظف"
                        >
                          <span className="ms-icon text-lg">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {canManageSuppliers && (
            <section className="g-card p-4 sm:p-5 space-y-4">
              <h3 className="text-base font-extrabold m-0 flex items-center gap-2">
                <span className="ms-icon filled text-[var(--g-primary)]">local_shipping</span>
                <span>الموردون وشركات التوريد ({data.suppliers?.length || 0})</span>
              </h3>

              {/* Single vs Bulk Supplier Entry Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <button
                  type="button"
                  onClick={() => setSupEntryMode('single')}
                  className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-all leading-tight ${
                    supEntryMode === 'single'
                      ? 'bg-[var(--g-surface)] text-[#146C2E] shadow-2xs'
                      : 'text-[var(--g-muted)]'
                  }`}
                >
                  + إضافة مورد مفرد
                </button>
                <button
                  type="button"
                  onClick={() => setSupEntryMode('bulk')}
                  className={`py-2 px-2 rounded-xl text-[11px] sm:text-xs font-extrabold transition-all leading-tight ${
                    supEntryMode === 'bulk'
                      ? 'bg-[var(--g-surface)] text-[#146C2E] shadow-2xs'
                      : 'text-[var(--g-muted)]'
                  }`}
                >
                  ⚡ لصق قائمة جماعية
                </button>
              </div>

              {supEntryMode === 'single' ? (
                <form
                  onSubmit={handleAddSupplier}
                  className="space-y-3 bg-[var(--g-surface-variant)]/50 p-3.5 rounded-2xl border border-[var(--g-border)]"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={supName}
                      onChange={(e) => setSupName(e.target.value)}
                      placeholder="اسم الشركة / المورد *"
                      className="g-input"
                    />
                    <select
                      value={supCategory}
                      onChange={(e) => setSupCategory(e.target.value)}
                      className="g-input"
                    >
                      {SUPPLIER_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={supPhone}
                      onChange={(e) => setSupPhone(e.target.value)}
                      placeholder="رقم المندوب أو ملاحظة اتصال (اختياري)"
                      className="g-input sm:col-span-2"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={supHasReturn}
                      onChange={(e) => setSupHasReturn(e.target.checked)}
                      className="w-4 h-4 accent-[#E37400]"
                    />
                    <span>يوجد مرتجع سابق مفتوح حالياً لدى هذا المورد (تنبيه أصفر تلقائي)</span>
                  </label>

                  {supHasReturn && (
                    <input
                      type="text"
                      value={supReturnNote}
                      onChange={(e) => setSupReturnNote(e.target.value)}
                      placeholder="تفاصيل المرتجع (مثل: 3 عبوات تالفة تخصم من الفاتورة القادمة)"
                      className="g-input w-full text-xs"
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {AVATAR_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSupColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-6 h-6 rounded-full ${
                            supColor === c ? 'ring-2 ring-offset-2 ring-[#146C2E]' : ''
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#146C2E] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center"
                    >
                      + حفظ المورد بالكروت السريعة
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={handleBulkAddSuppliers}
                  className="space-y-3 bg-[var(--g-surface-variant)]/50 p-3.5 rounded-2xl border border-[var(--g-border)]"
                >
                  <div>
                    <label className="block text-xs font-bold mb-1">تصنيف البضاعة لهذه الشركات</label>
                    <select
                      value={supCategory}
                      onChange={(e) => setSupCategory(e.target.value)}
                      className="g-input w-full"
                    >
                      {SUPPLIER_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">
                      اكتب أو الصق كل شركة/مورد في سطر مستقل:
                    </label>
                    <textarea
                      rows={5}
                      required
                      value={supBulkLines}
                      onChange={(e) => setSupBulkLines(e.target.value)}
                      placeholder={`مثال (اسم الشركة أو اسم الشركة - رقم المندوب):\nشركة جهينة للألبان - 01099887766\nشركة المراعي\nشركة بيبسي كولا`}
                      className="g-input w-full text-xs leading-relaxed"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-full bg-[#146C2E] text-white text-xs sm:text-sm font-extrabold"
                    >
                      + إضافة جميع الشركات دفعة واحدة
                    </button>
                  </div>
                </form>
              )}

              {(data.suppliers?.length || 0) > 4 && (
                <input
                  type="text"
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder="ابحث داخل الموردين..."
                  className="g-input w-full text-xs"
                />
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredSuppliers.length === 0 ? (
                  <p className="text-center py-6 text-xs text-[var(--g-muted)] m-0">
                    لا توجد شركات مضافة بعد — أضف مورديك الدائمين ليظهروا كأزرار لمس سريعة عند وصول العربيات.
                  </p>
                ) : (
                  filteredSuppliers.map((sup) => (
                    <div
                      key={sup.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-[var(--g-border)] text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-bold flex flex-wrap items-center gap-1.5">
                          <span className="truncate">{sup.name}</span>
                          {sup.has_pending_return === 1 && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] text-[10px] font-extrabold">
                              مرتجع معلق
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--g-muted)] truncate">
                          {sup.category}
                          {sup.phone ? ` • ${sup.phone}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {sup.phone && (
                          <a
                            href={`tel:${sup.phone}`}
                            className="px-2.5 py-1 rounded-full bg-[var(--g-primary-container)] text-[var(--g-primary)] text-xs font-extrabold flex items-center gap-1 no-underline"
                            title={`اتصال مباشر بـ ${sup.name}`}
                          >
                            <span className="ms-icon filled text-sm">call</span>
                            <span className="hidden sm:inline">اتصال</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSupplier({
                              ...sup,
                              has_pending_return: Boolean(sup.has_pending_return),
                            })
                          }
                          className="text-[var(--g-primary)] p-1.5 rounded-full hover:bg-[var(--g-primary-container)]"
                          title="تعديل المورد"
                        >
                          <span className="ms-icon text-lg">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSupplier(sup.id, sup.name)}
                          className="text-[var(--g-red)] p-1.5 rounded-full hover:bg-[var(--g-red-bg)]"
                          title="حذف المورد"
                        >
                          <span className="ms-icon text-lg">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* SubTab: Local Wi-Fi LAN + Cloud Sync + Smart Timer Thresholds */}
      {(canManageSettings || canManageBackup) && subTab === 'sync' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-5">
            {canManageSettings && (
              <section className="g-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="ms-icon filled text-[var(--g-green)] text-2xl">wifi</span>
                  <h3 className="text-base font-extrabold m-0">
                    1. التشغيل المحلي على واي فاي الماركت (أوفلاين وبدون رسوم)
                  </h3>
                </div>
                <p className="text-xs text-[var(--g-muted)] m-0">
                  افتح أحد الروابط التالية من موبايل فرد الأمن أو التابلت المتصل بنفس شبكة واي فاي
                  "زايد مارت"، وسجّل الدخول لمرة واحدة بكلمة مرور دوره:
                </p>

                {networkInfo.ips.length === 0 ? (
                  <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] text-xs">
                    الرابط الحالي: <strong className="num-ltr">{window.location.origin}</strong>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {networkInfo.ips.map((ip) => {
                      const lanUrl = `http://${ip.address}:${window.location.port || networkInfo.apiPort}`;
                      return (
                        <div
                          key={ip.address}
                          className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-[var(--g-muted)]">{ip.name}</div>
                            <div className="font-extrabold text-sm num-ltr text-[var(--g-primary)] truncate">
                              {lanUrl}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(lanUrl);
                              onToast?.('تم نسخ رابط الشبكة المحلية للموبايل!');
                            }}
                            className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold shrink-0"
                          >
                            نسخ
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="pt-3 border-t border-[var(--g-border)]">
                  <label className="flex items-center gap-2 text-xs sm:text-sm font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={voiceConfirmEnabled}
                      onChange={onToggleVoiceConfirm}
                      className="w-4 h-4 accent-[#0B57D0]"
                    />
                    <span>تفعيل النطق الصوتي بالعربية عند تسجيل الحضور والعربيات</span>
                  </label>
                </div>
              </section>
            )}

            {canManageBackup && (
              <section className="g-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="ms-icon filled text-[#E37400] text-2xl">backup</span>
                  <h3 className="text-base font-extrabold m-0">النسخ الاحتياطي وتصفير التجربة</h3>
                </div>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept="application/json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    className="px-4 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold flex items-center gap-1.5"
                  >
                    <span className="ms-icon text-base">download</span>
                    <span>تحميل نسخة احتياطية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => backupInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1.5"
                  >
                    <span className="ms-icon text-base">upload_file</span>
                    <span>استعادة نسخة</span>
                  </button>
                  {canManageUsers && data.connectionMode === 'local_server' && (
                    <button
                      type="button"
                      onClick={handleClearOperationalLogs}
                      className="px-4 py-2.5 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center gap-1.5"
                    >
                      <span className="ms-icon text-base">cleaning_services</span>
                      <span>تصفير حركات التجربة فقط</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--g-muted)] m-0">
                  زر "تصفير حركات التجربة" يمسح سجلات الحضور والعربيات التجريبية فقط ويحتفظ بأسماء الموظفين والموردين الحقيقيين وكلمات المرور.
                </p>
              </section>
            )}
          </div>

          {canManageSettings && (
            <form onSubmit={handleSaveSettings} className="g-card p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--g-border)] pb-3">
                <span className="ms-icon filled text-[var(--g-primary)] text-2xl">cloud_done</span>
                <div>
                  <h3 className="text-base font-extrabold m-0">
                    2. المتابعة السحابية وتنبيهات الوقت التلقائية
                  </h3>
                  <p className="text-xs text-[var(--g-muted)] m-0">
                    مزامنة مع تليفونك خارج الفرع + ضبط حدود التنبيهات البرتقالية
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الماركت</label>
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="g-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الفرع</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="g-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">
                    تنبيه الاستراحة البرتقالي بعد (دقيقة)
                  </label>
                  <input
                    type="number"
                    min={5}
                    value={maxBreak}
                    onChange={(e) => setMaxBreak(e.target.value)}
                    className="g-input w-full num-ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">
                    تنبيه تأخر العربية البرتقالي بعد (دقيقة)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={maxUnload}
                    onChange={(e) => setMaxUnload(e.target.value)}
                    className="g-input w-full num-ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  تغيير كلمة مرور حسابك الحالي (أو أدر جميع كلمات المرور من تبويب كلمات المرور)
                </label>
                <input
                  type="password"
                  value={newAdminPin}
                  onChange={(e) => setNewAdminPin(e.target.value)}
                  placeholder="الافتراضي الحالي للإدارة: 123 (اتركه فارغاً للإبقاء عليه)"
                  className="g-input w-full num-ltr"
                />
              </div>

              <div className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)]/60 border border-[var(--g-border)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[var(--g-primary)]">
                    المزامنة السحابية (Supabase Cloud)
                  </span>
                  {networkInfo.schemaSql && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(networkInfo.schemaSql);
                        onToast?.('تم نسخ كود إنشاء الجداول (SQL Schema) ✓');
                      }}
                      className="text-xs font-bold underline text-[var(--g-primary)]"
                    >
                      نسخ كود الجداول SQL
                    </button>
                  )}
                </div>

                <input
                  type="url"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://xxxx.supabase.co"
                  className="g-input w-full text-xs num-ltr"
                />
                <input
                  type="password"
                  value={supabaseKey}
                  onChange={(e) => setSupabaseKey(e.target.value)}
                  placeholder={
                    data.settings?.has_supabase_key
                      ? 'المفتاح السحابي محفوظ (اكتب فقط لتغييره)'
                      : 'Supabase Anon Key'
                  }
                  className="g-input w-full text-xs num-ltr"
                />

                <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cloudEnabled}
                    onChange={(e) => setCloudEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#0B57D0]"
                  />
                  <span>تفعيل المزامنة التلقائية الفورية مع السحابة</span>
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={handleTestCloud}
                    className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold"
                  >
                    اختبار الاتصال
                  </button>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={handleSyncCloudNow}
                    className="px-3 py-1.5 rounded-full g-pill-active text-xs"
                  >
                    مزامنة الآن ↻
                  </button>
                  {supabaseUrl && supabaseKey && (
                    <button
                      type="button"
                      onClick={() => {
                        const magic = buildMagicCloudShareUrl(
                          supabaseUrl.trim(),
                          supabaseKey.trim(),
                          storeName
                        );
                        navigator.clipboard?.writeText(magic);
                        onToast?.('تم نسخ رابط المتابعة المباشر لتليفونك 📱');
                      }}
                      className="px-3 py-1.5 rounded-full bg-[#146C2E] text-white text-xs font-bold"
                    >
                      رابط التليفون 📱
                    </button>
                  )}
                </div>

                {cloudStatusMsg && (
                  <p className="text-xs font-semibold text-[var(--g-primary)] m-0">
                    {cloudStatusMsg}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
              >
                حفظ كافة الإعدادات ✓
              </button>
            </form>
          )}
        </div>
      )}

      {/* Edit Employee Modal */}
      {editingEmployee && (
        <div onClick={() => setEditingEmployee(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditEmployee}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base sm:text-lg font-extrabold m-0">تعديل بيانات الموظف</h3>
              <button
                type="button"
                onClick={() => setEditingEmployee(null)}
                className="w-8 h-8 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">الاسم الثلاثي *</label>
                <input
                  type="text"
                  required
                  value={editingEmployee.name}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, name: e.target.value }))
                  }
                  className="g-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">القسم</label>
                <select
                  value={editingEmployee.department}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, department: e.target.value }))
                  }
                  className="g-input w-full"
                >
                  {DEPARTMENTS_LIST.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">المسمى الوظيفي</label>
                <input
                  type="text"
                  value={editingEmployee.role_title || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, role_title: e.target.value }))
                  }
                  className="g-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">رقم الموبايل</label>
                <input
                  type="tel"
                  value={editingEmployee.phone || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, phone: e.target.value }))
                  }
                  className="g-input w-full num-ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  كود الموظف / باسورد الدخول الشخصي
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
                  className="g-input w-full num-ltr"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold mb-1">
                  صلاحية الدخول للنظام (الرول)
                </label>
                <select
                  value={editingEmployee.system_role || ''}
                  onChange={(e) =>
                    setEditingEmployee((p) => ({ ...p, system_role: e.target.value }))
                  }
                  className="g-input w-full font-bold"
                >
                  {EMPLOYEE_SYSTEM_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold mb-1">من</label>
                  <input
                    type="time"
                    value={editingEmployee.shift_start || '08:00'}
                    onChange={(e) =>
                      setEditingEmployee((p) => ({ ...p, shift_start: e.target.value }))
                    }
                    className="g-input w-full num-ltr text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">إلى</label>
                  <input
                    type="time"
                    value={editingEmployee.shift_end || '17:00'}
                    onChange={(e) =>
                      setEditingEmployee((p) => ({ ...p, shift_end: e.target.value }))
                    }
                    className="g-input w-full num-ltr text-xs"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
            >
              حفظ التعديلات ✓
            </button>
          </form>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {editingSupplier && (
        <div onClick={() => setEditingSupplier(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditSupplier}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base sm:text-lg font-extrabold m-0">تعديل بيانات المورد</h3>
              <button
                type="button"
                onClick={() => setEditingSupplier(null)}
                className="w-8 h-8 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">اسم المورد / الشركة *</label>
                <input
                  type="text"
                  required
                  value={editingSupplier.name}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, name: e.target.value }))
                  }
                  className="g-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">تصنيف البضاعة</label>
                <select
                  value={editingSupplier.category}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, category: e.target.value }))
                  }
                  className="g-input w-full"
                >
                  {SUPPLIER_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold mb-1">رقم المندوب / تواصل</label>
                <input
                  type="text"
                  value={editingSupplier.phone || ''}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, phone: e.target.value }))
                  }
                  className="g-input w-full"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editingSupplier.has_pending_return)}
                onChange={(e) =>
                  setEditingSupplier((p) => ({
                    ...p,
                    has_pending_return: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-[#E37400]"
              />
              <span>يوجد مرتجع معلق لدى هذا المورد</span>
            </label>

            {editingSupplier.has_pending_return && (
              <input
                type="text"
                value={editingSupplier.pending_return_note || ''}
                onChange={(e) =>
                  setEditingSupplier((p) => ({
                    ...p,
                    pending_return_note: e.target.value,
                  }))
                }
                placeholder="تفاصيل المرتجع..."
                className="g-input w-full text-xs"
              />
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[#146C2E] text-white font-extrabold text-sm"
            >
              حفظ تعديلات المورد ✓
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
