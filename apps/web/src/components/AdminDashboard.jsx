import React, { useEffect, useMemo, useState } from 'react';
import { FilterChipRail } from './ui/index.js';
import { hasPermission } from '../lib/api.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import RbacSecurityPanel from './RbacSecurityPanel.jsx';
import AdminReportsPanel from './AdminReportsPanel.jsx';
import DashboardHeroStrip from './dashboard/DashboardHeroStrip.jsx';
import DashboardOverviewTab from './dashboard/DashboardOverviewTab.jsx';
import DashboardStaffTab from './dashboard/DashboardStaffTab.jsx';
import DashboardSuppliersTab from './dashboard/DashboardSuppliersTab.jsx';
import DashboardExportSheet from './dashboard/DashboardExportSheet.jsx';
import { buildAttentionItems } from './dashboard/DashboardAttentionPanel.jsx';

function isConnectedApiMode(connectionMode) {
  return connectionMode === 'local_server' || connectionMode === 'cloud_postgres';
}

function normalizeSubTabId(id) {
  if (!id) return null;
  if (id === 'timeline') return 'overview';
  if (id === 'sync') return 'system';
  return id;
}

/**
 * Pure Operational Cockpit Dashboard (`AdminDashboard.jsx`).
 * 5 focused sub-tabs (`نظرة عامة`, `الموظفون`, `الموردون`, `التقارير`, `الأمان`).
 * Legacy deep-links to `system` / `sync` cleanly route to the unified `SettingsView` (`النظام`).
 */
export default function AdminDashboard({
  data,
  authUser,
  permissions = [],
  requestedSubTab = null,
  onClearRequestedSubTab,
  onSelectTab,
  onSmartJumpTab,
  onOpenSettings,
  onOpenHandoverModal,
  onOpenQrModal,
  onOpenPersonLog,
  onRefresh,
  onToast,
  onPreviewImage,
}) {
  const arch = useThemeArchitecture();
  const role = authUser?.role || '';
  const isConnectedApi = isConnectedApiMode(data?.connectionMode);

  const canViewReports = hasPermission(permissions, role, 'reports:view');
  const canExportReports = hasPermission(permissions, role, 'reports:export');
  const canManageStaff = hasPermission(permissions, role, 'staff:manage');
  const canManageSuppliers = hasPermission(permissions, role, 'suppliers:manage');
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const canViewAudit = hasPermission(permissions, role, 'audit:view');
  const canManageRecords = hasPermission(permissions, role, 'records:manage');
  const canHandover = hasPermission(permissions, role, 'handover:manage');
  const canPrintCards =
    canManageStaff || hasPermission(permissions, role, 'attendance:read');

  const attentionItems = useMemo(() => buildAttentionItems(data), [data]);
  const criticalCount = useMemo(
    () => attentionItems.filter((i) => i.severity === 'critical').length,
    [attentionItems]
  );

  const availableSubTabs = useMemo(() => {
    const tabs = [
      {
        id: 'overview',
        label: 'نظرة عامة',
        count: attentionItems.length > 0 ? attentionItems.length : undefined,
        alert: criticalCount > 0,
      },
    ];

    if (canManageStaff) {
      tabs.push({
        id: 'staff',
        label: 'الموظفون',
        count: (data?.employees || []).length,
      });
    }

    if (canManageSuppliers) {
      const pendingReturns = Number(data?.summary?.pendingSupplierReturnsCount || 0);
      tabs.push({
        id: 'suppliers',
        label: 'الموردون',
        count: (data?.suppliers || []).length,
        alert: pendingReturns > 0,
      });
    }

    if (canViewReports) {
      tabs.push({
        id: 'reports',
        label: 'التقارير',
      });
    }

    if ((canManageUsers || canViewAudit) && isConnectedApi) {
      tabs.push({
        id: 'rbac',
        label: 'الأمان',
      });
    }

    return tabs;
  }, [
    attentionItems.length,
    criticalCount,
    canManageStaff,
    canManageSuppliers,
    canViewReports,
    canManageUsers,
    canViewAudit,
    isConnectedApi,
    data?.employees,
    data?.suppliers,
    data?.summary?.pendingSupplierReturnsCount,
  ]);

  const [subTab, setSubTab] = useState('overview');
  const [exportSheetOpen, setExportSheetOpen] = useState(false);

  function handleOpenSettingsPage(section = 'system') {
    if (onOpenSettings) {
      onOpenSettings(section);
    } else if (onSelectTab) {
      onSelectTab('settings');
    }
  }

  useEffect(() => {
    const normalized = normalizeSubTabId(requestedSubTab);
    if (!normalized) return;

    if (normalized === 'system') {
      handleOpenSettingsPage('system');
      onClearRequestedSubTab?.();
      return;
    }

    if (availableSubTabs.some((t) => t.id === normalized)) {
      setSubTab(normalized);
    } else if (
      normalized === 'staff' &&
      availableSubTabs.some((t) => t.id === 'suppliers')
    ) {
      setSubTab('suppliers');
    }
    onClearRequestedSubTab?.();
  }, [requestedSubTab, availableSubTabs, onClearRequestedSubTab]);

  useEffect(() => {
    if (availableSubTabs.length > 0 && !availableSubTabs.some((t) => t.id === subTab)) {
      setSubTab(availableSubTabs[0].id);
    }
  }, [availableSubTabs, subTab]);

  return (
    <div className={arch.surfaces.sectionGapClass}>
      <DashboardHeroStrip
        data={data}
        authUser={authUser}
        canExportReports={canExportReports}
        canHandover={canHandover}
        canPrintCards={canPrintCards}
        onOpenExportSheet={() => setExportSheetOpen(true)}
        onOpenHandoverModal={onOpenHandoverModal}
        onOpenQrModal={onOpenQrModal}
        onOpenSettings={
          onOpenSettings || (onSelectTab ? () => onSelectTab('settings') : undefined)
        }
      />

      {availableSubTabs.length > 1 && (
        <FilterChipRail
          items={availableSubTabs}
          activeId={subTab}
          onSelect={setSubTab}
        />
      )}

      {subTab === 'overview' && (
        <DashboardOverviewTab
          data={data}
          canManageStaff={canManageStaff}
          canManageSuppliers={canManageSuppliers}
          canManageRecords={canManageRecords}
          canViewReports={canViewReports}
          isConnectedApi={isConnectedApi}
          onSelectSubTab={setSubTab}
          onSmartJumpTab={onSmartJumpTab}
          onSelectTab={onSelectTab}
          onOpenHandoverModal={onOpenHandoverModal}
          onPreviewImage={onPreviewImage}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}

      {subTab === 'staff' && canManageStaff && (
        <DashboardStaffTab
          employees={data?.employees || []}
          role={role}
          onOpenQrModal={onOpenQrModal}
          onOpenPersonLog={onOpenPersonLog}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}

      {subTab === 'suppliers' && canManageSuppliers && (
        <DashboardSuppliersTab
          suppliers={data?.suppliers || []}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}

      {subTab === 'reports' && canViewReports && (
        <AdminReportsPanel
          data={data}
          canExportReports={canExportReports}
          isOwner={role === 'owner'}
          onOpenPersonLog={onOpenPersonLog}
          onToast={onToast}
        />
      )}

      {subTab === 'rbac' && (canManageUsers || canViewAudit) && (
        <RbacSecurityPanel
          canManageUsers={canManageUsers}
          canViewAudit={canViewAudit}
          currentUserId={authUser?.id}
          onOpenPersonLog={onOpenPersonLog}
          onRefreshParent={onRefresh}
          onToast={onToast}
        />
      )}

      <DashboardExportSheet
        open={exportSheetOpen}
        onClose={() => setExportSheetOpen(false)}
        data={data}
        onToast={onToast}
      />
    </div>
  );
}
