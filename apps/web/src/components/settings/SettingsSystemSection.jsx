import React, { useEffect, useRef, useState } from 'react';
import {
  apiRequest,
  buildMagicCloudShareUrl,
  hasPermission,
  isApiConnectedMode,
  purgeFakeData,
  saveDirectCloudCredentials,
} from '../../lib/api.js';
import {
  Button,
  ConfirmSheet,
  GroupedList,
  GroupedRow,
  Icon,
  ToggleSwitch,
} from '../ui/index.js';

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
 * Section 6: Store & System Administration.
 * Clean grouped rows preserving all admin controls & ConfirmSheet guards.
 */
export default function SettingsSystemSection({
  data,
  authUser,
  permissions = [],
  connectionMode = 'local_server',
  onRefresh,
  onToast,
}) {
  const backupInputRef = useRef(null);
  const role = authUser?.role || '';
  const canManageSettings = hasPermission(permissions, role, 'settings:manage');
  const canManageBackup = hasPermission(permissions, role, 'backup:manage');
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const isOnlineApi = isApiConnectedMode(connectionMode);

  const settings = data?.settings || {};

  const [storeName, setStoreName] = useState(settings.store_name || 'زايد مارت');
  const [branchName, setBranchName] = useState(settings.branch_name || 'الفرع الرئيسي');
  const [maxBreak, setMaxBreak] = useState(settings.max_break_minutes || 30);
  const [maxUnload, setMaxUnload] = useState(settings.max_unload_minutes || 60);
  const [loginShowRoleCards, setLoginShowRoleCards] = useState(
    settings.login_show_role_cards !== false
  );
  const [passwordMinLength, setPasswordMinLength] = useState(
    settings.password_min_length || 4
  );
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabase_url || '');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [cloudEnabled, setCloudEnabled] = useState(Boolean(settings.cloud_sync_enabled));
  const [savingSettings, setSavingSettings] = useState(false);

  const [networkInfo, setNetworkInfo] = useState({ ips: [], apiPort: 3001, schemaSql: '' });
  const [cloudStatusMsg, setCloudStatusMsg] = useState('');
  const [testingCloud, setTestingCloud] = useState(false);

  const [confirmAction, setConfirmAction] = useState(null); // 'clear_logs' | 'purge_fake' | 'revoke_all'
  const [executingDanger, setExecutingDanger] = useState(false);

  useEffect(() => {
    setStoreName(settings.store_name || 'زايد مارت');
    setBranchName(settings.branch_name || 'الفرع الرئيسي');
    setMaxBreak(settings.max_break_minutes || 30);
    setMaxUnload(settings.max_unload_minutes || 60);
    setLoginShowRoleCards(settings.login_show_role_cards !== false);
    setPasswordMinLength(settings.password_min_length || 4);
    setSupabaseUrl(settings.supabase_url || '');
    setCloudEnabled(Boolean(settings.cloud_sync_enabled));
  }, [
    settings.store_name,
    settings.branch_name,
    settings.max_break_minutes,
    settings.max_unload_minutes,
    settings.login_show_role_cards,
    settings.password_min_length,
    settings.supabase_url,
    settings.cloud_sync_enabled,
  ]);

  useEffect(() => {
    if (!canManageSettings || !isOnlineApi) return;
    apiRequest('/api/system/network', 'GET')
      .then((res) => {
        if (res) setNetworkInfo(res);
      })
      .catch(() => {});
  }, [canManageSettings, isOnlineApi]);

  async function handleSaveSettings(e) {
    e.preventDefault();
    if (!canManageSettings || savingSettings) return;
    setSavingSettings(true);
    try {
      const payload = {
        store_name: storeName.trim() || 'زايد مارت',
        branch_name: branchName.trim() || 'الفرع الرئيسي',
        max_break_minutes: Number(maxBreak) || 30,
        max_unload_minutes: Number(maxUnload) || 60,
        login_show_role_cards: Boolean(loginShowRoleCards),
        password_min_length: Math.min(16, Math.max(3, Number(passwordMinLength) || 4)),
        supabase_url: supabaseUrl.trim(),
        supabase_anon_key: supabaseKey.trim() ? supabaseKey.trim() : '***KEEP***',
        cloud_sync_enabled: cloudEnabled ? 'true' : 'false',
      };

      if (isOnlineApi) {
        await apiRequest('/api/settings', 'PUT', payload);
      } else if (supabaseUrl.trim() && supabaseKey.trim()) {
        saveDirectCloudCredentials({
          url: supabaseUrl.trim(),
          anonKey: supabaseKey.trim(),
          storeName: storeName.trim() || 'زايد مارت',
        });
      }

      setSupabaseKey('');
      onToast?.('تم حفظ الإعدادات');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ الإعدادات', 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleTestCloud() {
    setTestingCloud(true);
    setCloudStatusMsg('');
    try {
      const res = await apiRequest('/api/cloud/test', 'POST', {
        supabase_url: supabaseUrl.trim(),
        supabase_anon_key: supabaseKey.trim() || '***KEEP***',
      });
      setCloudStatusMsg(res?.message || '');
      onToast?.(res?.message || 'الاتصال سليم', res?.ok ? 'success' : 'error');
    } catch (err) {
      setCloudStatusMsg(err.message || 'فشل الاتصال');
      onToast?.(err.message || 'فشل الاتصال', 'error');
    } finally {
      setTestingCloud(false);
    }
  }

  async function handleSyncCloudNow() {
    setTestingCloud(true);
    setCloudStatusMsg('');
    try {
      const res = await apiRequest('/api/cloud/sync', 'POST');
      setCloudStatusMsg(res?.message || '');
      onToast?.(res?.message || 'تمت المزامنة');
      onRefresh?.();
    } catch (err) {
      setCloudStatusMsg(err.message || '');
      onToast?.(err.message || 'تعذرت المزامنة', 'error');
    } finally {
      setTestingCloud(false);
    }
  }

  async function handleExportBackup() {
    try {
      const backup = await apiRequest('/api/backup/export');
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zayed_mart_backup_${data?.dateKey || new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast?.('تم تحميل النسخة الاحتياطية');
    } catch (err) {
      onToast?.(err.message || 'تعذر التصدير', 'error');
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
      onToast?.(res?.message || 'تمت الاستعادة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'ملف غير صالح', 'error');
    }
  }

  async function handleExecuteDangerAction() {
    if (!confirmAction || executingDanger) return;
    setExecutingDanger(true);
    try {
      if (confirmAction === 'clear_logs') {
        await apiRequest('/api/system/clear-logs', 'POST');
        onToast?.('تم تصفير السجلات اليومية');
      } else if (confirmAction === 'purge_fake') {
        await purgeFakeData();
        onToast?.('تم تنظيف البيانات التجريبية');
      } else if (confirmAction === 'revoke_all') {
        const res = await apiRequest('/api/rbac/sessions/revoke-all', 'POST');
        onToast?.(`تم إنهاء ${res?.revokedCount || 0} جلسة`);
      }
      setConfirmAction(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تنفيذ الإجراء', 'error');
    } finally {
      setExecutingDanger(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1 & 2. Store, Timers & Cloud Settings */}
      {canManageSettings && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <GroupedList label="الفرع والمؤقتات">
            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-store-name"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                اسم الماركت
              </label>
              <input
                id="sys-store-name"
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="g-input flex-1 min-w-0"
              />
            </div>

            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-branch-name"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                الفرع
              </label>
              <input
                id="sys-branch-name"
                type="text"
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="g-input flex-1 min-w-0"
              />
            </div>

            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-max-break"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                مؤقت الاستراحة (د)
              </label>
              <input
                id="sys-max-break"
                type="number"
                min={5}
                max={180}
                value={maxBreak}
                onChange={(e) => setMaxBreak(e.target.value)}
                className="g-input num-ltr flex-1 min-w-0"
              />
            </div>

            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-max-unload"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                مؤقت التفريغ (د)
              </label>
              <input
                id="sys-max-unload"
                type="number"
                min={10}
                max={360}
                value={maxUnload}
                onChange={(e) => setMaxUnload(e.target.value)}
                className="g-input num-ltr flex-1 min-w-0"
              />
            </div>

            <ToggleSwitch
              grouped
              checked={loginShowRoleCards}
              onChange={setLoginShowRoleCards}
              label="صور الأدوار في الدخول"
            />
          </GroupedList>

          <GroupedList
            label="السحابة"
            actions={
              networkInfo.schemaSql ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await copyTextSafe(networkInfo.schemaSql);
                      onToast?.('تم نسخ SQL');
                    } catch {
                      onToast?.('تعذر النسخ', 'error');
                    }
                  }}
                  className="text-xs font-medium text-primary hover:underline min-h-[32px] px-1 cursor-pointer"
                >
                  نسخ SQL
                </button>
              ) : null
            }
          >
            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-supa-url"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                رابط المشروع
              </label>
              <input
                id="sys-supa-url"
                type="url"
                dir="ltr"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
                className="g-input num-ltr text-xs flex-1 min-w-0"
              />
            </div>

            <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label
                htmlFor="sys-supa-key"
                className="text-xs sm:text-sm font-medium text-ink-muted sm:w-36 shrink-0"
              >
                المفتاح
              </label>
              <input
                id="sys-supa-key"
                type="password"
                dir="ltr"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder={settings.has_supabase_key ? 'محفوظ' : 'Anon Key'}
                className="g-input num-ltr text-xs flex-1 min-w-0 placeholder:text-right"
              />
            </div>

            <ToggleSwitch
              grouped
              checked={cloudEnabled}
              onChange={setCloudEnabled}
              label="المزامنة السحابية"
            />

            <div className="px-3.5 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="network_check"
                  loading={testingCloud}
                  disabled={!isOnlineApi}
                  onClick={handleTestCloud}
                >
                  اختبار
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="sync"
                  loading={testingCloud}
                  disabled={!isOnlineApi}
                  onClick={handleSyncCloudNow}
                >
                  مزامنة الآن
                </Button>
                {supabaseUrl && supabaseKey && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="qr_code"
                    onClick={async () => {
                      const magic = buildMagicCloudShareUrl(
                        supabaseUrl.trim(),
                        supabaseKey.trim(),
                        storeName
                      );
                      try {
                        await copyTextSafe(magic);
                        onToast?.('تم نسخ رابط الهاتف');
                      } catch {
                        onToast?.('تعذر النسخ', 'error');
                      }
                    }}
                  >
                    نسخ الرابط
                  </Button>
                )}
              </div>

              {cloudStatusMsg && (
                <div className="text-xs font-medium text-primary">{cloudStatusMsg}</div>
              )}
            </div>
          </GroupedList>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingSettings}
            >
              حفظ الإعدادات
            </Button>
          </div>
        </form>
      )}

      {/* 3. Local Network */}
      {canManageSettings && networkInfo.ips?.length > 0 && (
        <GroupedList label="الشبكة المحلية">
          {networkInfo.ips.map((ip) => {
            const lanUrl = `http://${ip.address}:${networkInfo.apiPort || 3001}`;
            return (
              <GroupedRow
                key={ip.address}
                onClick={async () => {
                  try {
                    await copyTextSafe(lanUrl);
                    onToast?.('تم نسخ الرابط');
                  } catch {
                    onToast?.('تعذر النسخ', 'error');
                  }
                }}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink-muted">{ip.name}</div>
                  <div className="text-xs sm:text-sm font-medium num-ltr text-primary truncate">
                    {lanUrl}
                  </div>
                </div>
                <Icon name="content_copy" size={18} className="text-ink-muted shrink-0" />
              </GroupedRow>
            );
          })}
        </GroupedList>
      )}

      {/* 4. Backup & Restore */}
      {canManageBackup && (
        <>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
            className="hidden"
          />
          <GroupedList label="النسخ الاحتياطي">
            <GroupedRow
              onClick={isOnlineApi ? handleExportBackup : undefined}
              className={!isOnlineApi ? 'opacity-45 cursor-not-allowed' : ''}
            >
              <span className="text-xs sm:text-sm font-medium text-ink">
                تصدير نسخة JSON
              </span>
              <Icon name="download" size={18} className="text-ink-muted" />
            </GroupedRow>

            <GroupedRow
              onClick={isOnlineApi ? () => backupInputRef.current?.click() : undefined}
              className={!isOnlineApi ? 'opacity-45 cursor-not-allowed' : ''}
            >
              <span className="text-xs sm:text-sm font-medium text-ink">
                استيراد نسخة JSON
              </span>
              <Icon name="upload_file" size={18} className="text-ink-muted" />
            </GroupedRow>
          </GroupedList>
        </>
      )}

      {/* 5. Maintenance */}
      {canManageUsers && (
        <GroupedList label="صيانة">
          <GroupedRow
            onClick={isOnlineApi ? () => setConfirmAction('revoke_all') : undefined}
            className={!isOnlineApi ? 'opacity-45 cursor-not-allowed' : ''}
          >
            <span className="text-xs sm:text-sm font-medium text-danger">
              إنهاء جلسات الأجهزة الأخرى
            </span>
            <Icon name="phonelink_erase" size={18} className="text-danger" />
          </GroupedRow>

          <GroupedRow
            onClick={isOnlineApi ? () => setConfirmAction('clear_logs') : undefined}
            className={!isOnlineApi ? 'opacity-45 cursor-not-allowed' : ''}
          >
            <span className="text-xs sm:text-sm font-medium text-danger">
              تصفير السجلات اليومية
            </span>
            <Icon name="cleaning_services" size={18} className="text-danger" />
          </GroupedRow>

          <GroupedRow
            onClick={isOnlineApi ? () => setConfirmAction('purge_fake') : undefined}
            className={!isOnlineApi ? 'opacity-45 cursor-not-allowed' : ''}
          >
            <span className="text-xs sm:text-sm font-medium text-danger">
              تنظيف البيانات التجريبية
            </span>
            <Icon name="auto_delete" size={18} className="text-danger" />
          </GroupedRow>
        </GroupedList>
      )}

      <ConfirmSheet
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleExecuteDangerAction}
        loading={executingDanger}
        tone="danger"
        title={
          confirmAction === 'clear_logs'
            ? 'تصفير السجلات اليومية'
            : confirmAction === 'purge_fake'
            ? 'تنظيف البيانات التجريبية'
            : 'إنهاء جلسات الأجهزة الأخرى'
        }
        description={
          confirmAction === 'clear_logs'
            ? 'مسح سجلات الحركات اليومية مع الإبقاء على الموظفين والموردين؟'
            : confirmAction === 'purge_fake'
            ? 'حذف البيانات التجريبية والإبقاء على البيانات الحقيقية فقط؟'
            : 'تسجيل خروج جميع الأجهزة الأخرى مع بقاء هذا الجهاز متصلاً؟'
        }
        confirmLabel="تنفيذ"
      />
    </div>
  );
}
