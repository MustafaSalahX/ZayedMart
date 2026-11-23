import React, { useEffect, useRef, useState } from 'react';
import { isApiConnectedMode, updateMyPreferences } from '../../lib/api.js';
import { useTheme } from '../../lib/themeContext.jsx';
import {
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  MODE_OPTIONS,
  SCALE_OPTIONS,
  THEMES_REGISTRY,
} from '../../lib/themeRegistry.js';
import {
  GroupedList,
  SegmentedControl,
  ThemePreviewCard,
  ToggleSwitch,
} from '../ui/index.js';

const FONT_SHORT_LABELS = {
  auto: 'تلقائي',
  cairo: 'Cairo',
  ibm: 'IBM',
  tajawal: 'Tajawal',
  readex: 'Readex',
};

const GLASS_SEGMENTS = [
  { id: 'auto', labelAr: 'كامل' },
  { id: 'reduced', labelAr: 'خفيف' },
  { id: 'off', labelAr: 'مطفأ' },
];

/**
 * Section 3: Appearance & 5-Theme Picker.
 * Detoxed Apple iOS / Linear grouped controls + progressive disclosure for Liquid Glass.
 */
export default function SettingsAppearanceSection({
  connectionMode = 'local_server',
  onToast,
}) {
  const {
    theme,
    setTheme,
    modePref,
    setModePref,
    resolvedMode,
    fontFamily,
    setFontFamily,
    fontScale,
    setFontScale,
    density,
    setDensity,
    glassMode,
    setGlassMode,
    liteMode,
    setLiteMode,
    resetDisplayDefaults,
    preferences,
  } = useTheme();

  const [syncState, setSyncState] = useState('idle');
  const syncTimerRef = useRef(null);
  const mountedRef = useRef(false);

  // Debounced background sync of theme & display preferences to user account when online
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }

    setSyncState('saving');
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

    syncTimerRef.current = setTimeout(async () => {
      if (!isApiConnectedMode(connectionMode)) {
        setSyncState('local');
        return;
      }
      try {
        await updateMyPreferences({
          theme,
          modePref,
          fontFamily,
          fontScale,
          density,
          glassMode,
          liteMode: Boolean(liteMode),
        });
        setSyncState('synced');
      } catch {
        setSyncState('local');
      }
    }, 550);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [
    theme,
    modePref,
    fontFamily,
    fontScale,
    density,
    glassMode,
    liteMode,
    connectionMode,
    preferences,
  ]);

  return (
    <div className="space-y-6">
      {/* 1. Light / Dark / System 1-Row SegmentedControl */}
      <SegmentedControl
        options={MODE_OPTIONS}
        value={modePref}
        onChange={setModePref}
        ariaLabel="وضع الإضاءة"
        fullWidth
      />

      {/* 2. 5-Theme Interactive Picker */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-muted px-1 m-0">الثيم</h3>
        <div
          role="radiogroup"
          aria-label="الثيم"
          className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3"
        >
          {THEMES_REGISTRY.map((item) => (
            <ThemePreviewCard
              key={item.id}
              theme={item}
              previewMode={resolvedMode}
              selected={theme === item.id}
              onSelect={(id) => {
                setTheme(id);
                onToast?.(`تم تفعيل ثيم ${item.nameAr}`);
              }}
            />
          ))}
        </div>
      </section>

      {/* 3. Typography & Display GroupedList */}
      <GroupedList label="العرض والخط">
        {/* Font Family */}
        <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span className="text-xs sm:text-sm font-medium text-ink shrink-0">
            الخط
          </span>
          <div
            role="radiogroup"
            aria-label="الخط"
            className="flex flex-wrap items-center gap-1.5"
          >
            {FONT_OPTIONS.map((f) => {
              const active = fontFamily === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFontFamily(f.id)}
                  className={`min-h-[40px] sm:min-h-[34px] px-2.5 py-1 rounded-[var(--g-radius-sm)] text-xs font-medium border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                    active
                      ? 'bg-primary-container text-on-primary-container border-primary font-semibold'
                      : 'bg-transparent text-ink-muted hover:text-ink border-line'
                  }`}
                >
                  {FONT_SHORT_LABELS[f.id] || f.labelAr}
                </button>
              );
            })}
          </div>
        </div>

        {/* Text Scale */}
        <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span className="text-xs sm:text-sm font-medium text-ink shrink-0">
            حجم النص
          </span>
          <SegmentedControl
            fullWidthOnMobile
            options={SCALE_OPTIONS.map((s) => ({ id: s.id, labelAr: s.labelAr }))}
            value={fontScale}
            onChange={setFontScale}
            ariaLabel="حجم النص"
          />
        </div>

        {/* Density */}
        <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span className="text-xs sm:text-sm font-medium text-ink shrink-0">
            الكثافة
          </span>
          <SegmentedControl
            fullWidthOnMobile
            options={DENSITY_OPTIONS.map((d) => ({
              id: d.id,
              labelAr: d.id === 'compact' ? 'مكثف' : d.labelAr,
            }))}
            value={density}
            onChange={setDensity}
            ariaLabel="الكثافة"
          />
        </div>

        {/* Progressive Disclosure: Glass Transparency ONLY when Liquid Glass is active */}
        {theme === 'liquid-glass' && (
          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span className="text-xs sm:text-sm font-medium text-ink shrink-0">
              الشفافية
            </span>
            <SegmentedControl
              fullWidthOnMobile
              options={GLASS_SEGMENTS}
              value={glassMode}
              onChange={setGlassMode}
              ariaLabel="الشفافية"
            />
          </div>
        )}

        {/* Lite Mode */}
        <ToggleSwitch
          grouped
          checked={Boolean(liteMode)}
          onChange={(val) => {
            setLiteMode(val);
            onToast?.(val ? 'تم تفعيل الأداء الخفيف' : 'تم إيقاف الأداء الخفيف');
          }}
          label="الأداء الخفيف"
        />
      </GroupedList>

      {/* 4. Quiet Bottom Reset + Subtle Save Indicator */}
      <div className="flex items-center justify-between gap-3 px-1">
        <button
          type="button"
          onClick={() => {
            resetDisplayDefaults();
            onToast?.('تمت استعادة الإعدادات الافتراضية');
          }}
          className="min-h-[44px] sm:min-h-[36px] px-1 text-xs font-medium text-ink-muted hover:text-ink transition-[color] duration-150 cursor-pointer"
        >
          استعادة الافتراضي
        </button>

        {syncState !== 'idle' && (
          <span className="text-[11px] font-medium text-ink-muted">
            {syncState === 'saving' ? 'جاري الحفظ...' : 'تم الحفظ'}
          </span>
        )}
      </div>
    </div>
  );
}
