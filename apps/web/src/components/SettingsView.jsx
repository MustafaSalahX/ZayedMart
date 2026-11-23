import React, { useEffect, useMemo, useState } from 'react';
import { hasAnyPermission, hasPermission } from '../lib/api.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import SettingsAppearanceSection from './settings/SettingsAppearanceSection.jsx';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection.jsx';
import SettingsProfileSection from './settings/SettingsProfileSection.jsx';
import SettingsRoleAccountsSection from './settings/SettingsRoleAccountsSection.jsx';
import SettingsSecuritySection from './settings/SettingsSecuritySection.jsx';
import SettingsSystemSection from './settings/SettingsSystemSection.jsx';
import { Button, FilterChipRail, Icon } from './ui/index.js';

/**
 * Apple iOS / Linear Grouped Settings Page.
 * Accessible to ALL 9 non-kiosk roles with strict RBAC section gating.
 */
export default function SettingsView({
  data,
  authUser,
  myProfile,
  permissions = [],
  connectionMode = 'local_server',
  offlineQueueCount = 0,
  isSyncing = false,
  initialSection = 'profile',
  section: controlledSection,
  onChangeSection,
  onFlushOfflineQueue,
  onUserUpdated,
  onOpenPersonLog,
  onJumpToRbacMatrix,
  onLogout,
  onRefresh,
  onToast,
}) {
  const arch = useThemeArchitecture();
  const isMinimal = arch.id === 'minimal';
  const isGlass = arch.id === 'liquid-glass';

  const role = authUser?.role || '';
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const canAccessSystem = hasAnyPermission(permissions, role, [
    'settings:manage',
    'backup:manage',
    'users:manage',
  ]);

  const sections = useMemo(() => {
    const list = [
      { id: 'profile', label: 'الملف الشخصي', icon: 'account_circle' },
      { id: 'security', label: 'الأمان', icon: 'lock_reset' },
      { id: 'appearance', label: 'المظهر', icon: 'palette' },
    ];

    if (canManageUsers) {
      list.push({ id: 'roles', label: 'الأدوار', icon: 'admin_panel_settings' });
    }

    list.push({ id: 'preferences', label: 'التطبيق', icon: 'tune' });

    if (canAccessSystem) {
      list.push({ id: 'system', label: 'النظام', icon: 'settings_suggest' });
    }

    return list;
  }, [canManageUsers, canAccessSystem]);

  const [activeSection, setActiveSection] = useState(
    () => controlledSection || initialSection || 'profile'
  );

  useEffect(() => {
    const next = controlledSection || initialSection;
    if (next && sections.some((s) => s.id === next)) {
      setActiveSection(next);
    }
  }, [controlledSection, initialSection, sections]);

  useEffect(() => {
    if (!sections.some((s) => s.id === activeSection)) {
      setActiveSection(sections[0]?.id || 'profile');
    }
  }, [sections, activeSection]);

  function handleSelectSection(id) {
    setActiveSection(id);
    onChangeSection?.(id);
  }

  return (
    <div className={arch.surfaces.sectionGapClass}>
      {/* Borderless 1-Line Page Header */}
      <div
        className={`flex items-center justify-between gap-3 ${
          isMinimal ? 'pb-2.5 border-b border-line' : ''
        }`}
      >
        <h1
          className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0`}
        >
          الإعدادات
        </h1>

        {onLogout && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="text-danger hover:bg-danger-bg"
          >
            <Icon name="logout" size={18} />
            <span>تسجيل الخروج</span>
          </Button>
        )}
      </div>

      {/* Mobile & Tablet Horizontal Section Tabs (< lg) */}
      <div className="lg:hidden">
        <FilterChipRail
          items={sections}
          activeId={activeSection}
          onSelect={handleSelectSection}
        />
      </div>

      {/* Desktop 12-Col Master-Detail Layout (>= lg) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside
          aria-label="أقسام الإعدادات"
          className="hidden lg:flex lg:flex-col lg:col-span-3 sticky top-[calc(var(--topbar-h)+1rem)] gap-0.5"
        >
          {sections.map((sec) => {
            const active = activeSection === sec.id;
            const activeCls = isMinimal
              ? 'text-ink font-semibold border-s-2 border-ink rounded-none bg-transparent'
              : isGlass
              ? 'bg-glass-pill text-ink font-semibold border border-[var(--g-glass-border)] shadow-[var(--g-glass-pill-specular)]'
              : 'bg-surface-2 text-ink font-semibold';

            const idleCls = isMinimal
              ? 'text-ink-muted hover:text-ink border-s-2 border-transparent rounded-none font-medium'
              : 'text-ink-muted hover:text-ink hover:bg-surface-tint font-medium border border-transparent';

            return (
              <button
                key={sec.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => handleSelectSection(sec.id)}
                className={`w-full min-h-[44px] px-3 py-2 rounded-[var(--g-radius-md)] text-start text-sm flex items-center gap-2.5 transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                  active ? activeCls : idleCls
                }`}
              >
                <Icon
                  name={sec.icon}
                  size={18}
                  filled={active}
                  className={`shrink-0 ${active ? 'text-primary' : 'text-ink-muted'}`}
                />
                <span className="truncate">{sec.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Active Settings Content Pane */}
        <div className="lg:col-span-9 min-w-0 max-w-3xl">
          {activeSection === 'profile' && (
            <SettingsProfileSection
              authUser={authUser}
              myProfile={myProfile}
              permissions={permissions}
              connectionMode={connectionMode}
              onUserUpdated={onUserUpdated}
              onNavigateSection={handleSelectSection}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {activeSection === 'security' && (
            <SettingsSecuritySection
              authUser={authUser}
              myProfile={myProfile}
              permissions={permissions}
              connectionMode={connectionMode}
              onUserUpdated={onUserUpdated}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {activeSection === 'appearance' && (
            <SettingsAppearanceSection
              connectionMode={connectionMode}
              onToast={onToast}
            />
          )}

          {activeSection === 'roles' && canManageUsers && (
            <SettingsRoleAccountsSection
              authUser={authUser}
              connectionMode={connectionMode}
              onUserUpdated={onUserUpdated}
              onOpenPersonLog={onOpenPersonLog}
              onJumpToRbacMatrix={onJumpToRbacMatrix}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {activeSection === 'preferences' && (
            <SettingsPreferencesSection
              connectionMode={connectionMode}
              offlineQueueCount={offlineQueueCount}
              isSyncing={isSyncing}
              onFlushOfflineQueue={onFlushOfflineQueue}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {activeSection === 'system' && canAccessSystem && (
            <SettingsSystemSection
              data={data}
              authUser={authUser}
              permissions={permissions}
              connectionMode={connectionMode}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}
        </div>
      </div>
    </div>
  );
}
