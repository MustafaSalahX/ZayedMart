import React, { useEffect, useState } from 'react';
import {
  getConfiguredApiBaseUrl,
  isApiConnectedMode,
  setConfiguredApiBaseUrl,
  updateMyPreferences,
} from '../../lib/api.js';
import { playSuccessChime } from '../../lib/audio.js';
import {
  getPwaInstallState,
  getSyncState,
  subscribePwaInstallState,
  subscribeSyncState,
  triggerPwaInstall,
} from '../../lib/localDb.js';
import { useTheme } from '../../lib/themeContext.jsx';
import {
  Button,
  ConfirmSheet,
  GroupedList,
  GroupedRow,
  Icon,
  StatusDot,
  ToggleSwitch,
} from '../ui/index.js';

/**
 * Section 5: App Preferences, Audio, Sync & Install.
 * Apple iOS / Linear grouped rows with zero prose.
 */
export default function SettingsPreferencesSection({
  connectionMode = 'local_server',
  offlineQueueCount = 0,
  isSyncing = false,
  onFlushOfflineQueue,
  onRefresh,
  onToast,
}) {
  const {
    voiceConfirm,
    setVoiceConfirm,
    uiSounds,
    setUiSounds,
    walkieChimes,
    setWalkieChimes,
  } = useTheme();

  const [pwaState, setPwaState] = useState(() => getPwaInstallState());
  const [syncInfo, setSyncInfo] = useState(() => getSyncState());
  const [serverUrlInput, setServerUrlInput] = useState(() => getConfiguredApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [confirmClearCacheOpen, setConfirmClearCacheOpen] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    const unsubPwa = subscribePwaInstallState(setPwaState);
    const unsubSync = subscribeSyncState(setSyncInfo);
    return () => {
      unsubPwa();
      unsubSync();
    };
  }, []);

  async function syncAudioPrefToServer(patch) {
    if (!isApiConnectedMode(connectionMode)) return;
    try {
      await updateMyPreferences(patch);
    } catch {
      // local preference already saved by ThemeContext
    }
  }

  function handleSaveServerUrl() {
    const saved = setConfiguredApiBaseUrl(serverUrlInput);
    setServerUrlInput(saved);
    onToast?.(saved ? 'تم حفظ عنوان السيرفر' : 'تم الضبط على التلقائي');
    onRefresh?.();
  }

  async function handleSafeCacheRefresh() {
    setClearingCache(true);
    try {
      if (typeof indexedDB !== 'undefined') {
        await new Promise((resolve) => {
          try {
            const req = indexedDB.open('zayed_mart_local_db_v1', 1);
            req.onsuccess = () => {
              try {
                const db = req.result;
                const tx = db.transaction(['daily_snapshots'], 'readwrite');
                tx.objectStore('daily_snapshots').clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
              } catch {
                resolve(false);
              }
            };
            req.onerror = () => resolve(false);
          } catch {
            resolve(false);
          }
        });
      }
      setConfirmClearCacheOpen(false);
      await onRefresh?.();
      onToast?.('تم تحديث الكاش');
    } finally {
      setClearingCache(false);
    }
  }

  const connTone =
    connectionMode === 'offline_cached' || !syncInfo.online
      ? 'warning'
      : connectionMode === 'cloud_postgres' || connectionMode === 'local_server'
      ? 'success'
      : 'primary';

  const connLabel =
    connectionMode === 'offline_cached' || !syncInfo.online
      ? 'أوفلاين'
      : connectionMode === 'cloud_postgres' || connectionMode === 'direct_cloud'
      ? 'سحابي'
      : 'متصل';

  const showInstallGroup =
    !pwaState.isStandalone &&
    (pwaState.canPromptInstall || pwaState.isAndroid || pwaState.isIOS);

  return (
    <div className="space-y-6">
      {/* 1. Audio Toggles */}
      <GroupedList
        label="الأصوات"
        actions={
          <button
            type="button"
            onClick={() => {
              playSuccessChime('in');
              onToast?.('تم تشغيل نغمة الاختبار');
            }}
            className="text-xs font-medium text-primary hover:underline min-h-[32px] px-1 cursor-pointer"
          >
            اختبار
          </button>
        }
      >
        <ToggleSwitch
          grouped
          checked={Boolean(voiceConfirm)}
          onChange={(val) => {
            setVoiceConfirm(val);
            syncAudioPrefToServer({ voiceConfirm: val });
          }}
          label="النطق الصوتي"
        />

        <ToggleSwitch
          grouped
          checked={Boolean(uiSounds)}
          onChange={(val) => {
            setUiSounds(val);
            syncAudioPrefToServer({ uiSounds: val });
          }}
          label="أصوات الواجهة"
        />

        <ToggleSwitch
          grouped
          checked={Boolean(walkieChimes)}
          onChange={(val) => {
            setWalkieChimes(val);
            syncAudioPrefToServer({ walkieChimes: val });
          }}
          label="نغمة اللاسلكي"
        />
      </GroupedList>

      {/* 2. Sync & Cache */}
      <GroupedList label="المزامنة">
        <GroupedRow>
          <span className="text-xs sm:text-sm font-medium text-ink">الحالة</span>
          <div className="flex items-center gap-2">
            <StatusDot
              tone={connTone}
              pulse={isSyncing}
              label={
                offlineQueueCount > 0
                  ? `${connLabel} · معلق ${offlineQueueCount}`
                  : connLabel
              }
            />
          </div>
        </GroupedRow>

        <GroupedRow onClick={() => onFlushOfflineQueue?.()}>
          <span className="text-xs sm:text-sm font-medium text-ink">
            مزامنة الآن
          </span>
          <Icon
            name="sync"
            size={18}
            spin={isSyncing}
            className={isSyncing ? 'text-primary' : 'text-ink-muted'}
          />
        </GroupedRow>

        <GroupedRow onClick={() => setConfirmClearCacheOpen(true)}>
          <span className="text-xs sm:text-sm font-medium text-ink">
            تحديث الكاش
          </span>
          <Icon name="cached" size={18} className="text-ink-muted" />
        </GroupedRow>
      </GroupedList>

      {/* 3. Install (Hidden when already installed / standalone) */}
      {showInstallGroup && (
        <GroupedList label="التثبيت">
          {pwaState.canPromptInstall && (
            <GroupedRow
              onClick={async () => {
                const res = await triggerPwaInstall();
                if (res?.outcome === 'accepted') {
                  onToast?.('تم تثبيت التطبيق');
                }
              }}
            >
              <span className="text-xs sm:text-sm font-medium text-ink">
                تثبيت التطبيق
              </span>
              <Icon name="install_mobile" size={18} className="text-primary" />
            </GroupedRow>
          )}

          {!pwaState.isIOS && (
            <a
              href="/zayed-mart.apk"
              download="zayed-mart-ops.apk"
              className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium text-ink hover:bg-surface-tint no-underline"
            >
              <span>تحميل ملف APK</span>
              <Icon name="android" size={18} className="text-ink-muted" />
            </a>
          )}

          {pwaState.isIOS && !pwaState.canPromptInstall && (
            <GroupedRow>
              <span className="text-xs sm:text-sm font-medium text-ink">
                إضافة للشاشة الرئيسية
              </span>
              <span className="text-xs text-ink-muted">Share</span>
            </GroupedRow>
          )}
        </GroupedList>
      )}

      {/* 4. Collapsible Server URL */}
      <GroupedList>
        <GroupedRow
          onClick={() => setShowServerConfig((v) => !v)}
          aria-expanded={showServerConfig}
        >
          <span className="text-xs sm:text-sm font-medium text-ink">
            عنوان السيرفر
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-ink-muted num-ltr truncate max-w-[160px] sm:max-w-[240px]">
              {serverUrlInput || 'تلقائي'}
            </span>
            <Icon
              name={showServerConfig ? 'expand_less' : 'expand_more'}
              size={18}
              className="text-ink-muted shrink-0"
            />
          </div>
        </GroupedRow>

        {showServerConfig && (
          <div className="px-3.5 py-3 space-y-2.5">
            <input
              type="url"
              dir="ltr"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="https://... أو http://192.168.1.100:3001"
              className="g-input num-ltr text-xs sm:text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="primary" size="sm" onClick={handleSaveServerUrl}>
                حفظ
              </Button>
              {serverUrlInput && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfiguredApiBaseUrl('');
                    setServerUrlInput('');
                    onToast?.('تم الضبط على التلقائي');
                    onRefresh?.();
                  }}
                >
                  تلقائي
                </Button>
              )}
            </div>
          </div>
        )}
      </GroupedList>

      <ConfirmSheet
        open={confirmClearCacheOpen}
        onClose={() => setConfirmClearCacheOpen(false)}
        onConfirm={handleSafeCacheRefresh}
        loading={clearingCache}
        tone="primary"
        title="تحديث الكاش"
        description="إعادة تحميل البيانات المؤقتة دون مساس بالحركات المعلقة؟"
        confirmLabel="تحديث"
      />
    </div>
  );
}
