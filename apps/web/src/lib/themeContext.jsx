import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { getThemeArchitecture } from './themeArchitecture.js';
import {
  DEFAULT_DISPLAY_PREFS,
  THEME_MAP,
  getThemeMetaColor,
  normalizeDensity,
  normalizeFontFamily,
  normalizeFontScale,
  normalizeGlassMode,
  normalizeModePref,
  normalizeThemeId,
} from './themeRegistry.js';

const STORAGE_KEYS = {
  theme: 'zayed_theme_v1',
  themeExplicitV2: 'zayed_theme_explicit_v2',
  modePref: 'zayed_color_mode_v1',
  legacyDark: 'zayed_dark_mode',
  fontFamily: 'zayed_font_family_v2',
  fontScale: 'zayed_font_scale',
  density: 'zayed_density_v1',
  glassMode: 'zayed_glass_mode_v1',
  liteMode: 'zayed_mart_lite_mode_v1',
  voiceConfirm: 'zayed_voice_confirm',
  uiSounds: 'zayed_ui_sounds_v1',
  walkieChimes: 'zayed_walkie_chimes_v1',
};

function detectLowEndDevice() {
  if (typeof navigator === 'undefined') return false;
  try {
    const mem = Number(navigator.deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    if (mem > 0 && mem <= 2) return true;
    if (cores > 0 && cores <= 4 && /Android/i.test(navigator.userAgent || '')) return true;
  } catch {
    // ignore
  }
  return false;
}

function readInitialBool(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // ignore
  }
  return fallback;
}

function markExplicitThemeV2() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.themeExplicitV2, '1');
  } catch {
    // ignore storage quota errors
  }
}

function readInitialPrefs() {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_DISPLAY_PREFS };
  }
  try {
    const explicitV2 = localStorage.getItem(STORAGE_KEYS.themeExplicitV2);
    const rawTheme = localStorage.getItem(STORAGE_KEYS.theme);
    let theme;
    if (explicitV2 !== '1') {
      if (!rawTheme || rawTheme === 'classic') {
        theme = 'minimal';
        try {
          localStorage.setItem(STORAGE_KEYS.theme, 'minimal');
        } catch {
          // ignore
        }
      } else {
        theme = normalizeThemeId(rawTheme);
        try {
          localStorage.setItem(STORAGE_KEYS.theme, theme);
          localStorage.setItem(STORAGE_KEYS.themeExplicitV2, '1');
        } catch {
          // ignore
        }
      }
    } else {
      theme = normalizeThemeId(rawTheme);
    }
    const rawMode = localStorage.getItem(STORAGE_KEYS.modePref);
    const modePref = rawMode
      ? normalizeModePref(rawMode)
      : localStorage.getItem(STORAGE_KEYS.legacyDark) === 'true'
      ? 'dark'
      : 'light';
    const fontFamily = normalizeFontFamily(localStorage.getItem(STORAGE_KEYS.fontFamily) || 'auto');
    const fontScale = normalizeFontScale(localStorage.getItem(STORAGE_KEYS.fontScale));
    const density = normalizeDensity(localStorage.getItem(STORAGE_KEYS.density));
    const glassMode = normalizeGlassMode(localStorage.getItem(STORAGE_KEYS.glassMode));
    const liteSaved = localStorage.getItem(STORAGE_KEYS.liteMode);
    const liteMode =
      liteSaved === 'true'
        ? true
        : liteSaved === 'false'
        ? false
        : detectLowEndDevice();

    return {
      theme,
      modePref,
      fontFamily,
      fontScale,
      density,
      glassMode,
      liteMode,
      voiceConfirm: readInitialBool(STORAGE_KEYS.voiceConfirm, true),
      uiSounds: readInitialBool(STORAGE_KEYS.uiSounds, true),
      walkieChimes: readInitialBool(STORAGE_KEYS.walkieChimes, true),
    };
  } catch {
    return { ...DEFAULT_DISPLAY_PREFS };
  }
}

function readSystemDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function persistLocalPrefs(prefs) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, prefs.theme);
    localStorage.setItem(STORAGE_KEYS.modePref, prefs.modePref);
    localStorage.setItem(STORAGE_KEYS.legacyDark, String(prefs.modePref === 'dark'));
    localStorage.setItem(STORAGE_KEYS.fontFamily, prefs.fontFamily);
    localStorage.setItem(STORAGE_KEYS.fontScale, prefs.fontScale);
    localStorage.setItem(STORAGE_KEYS.density, prefs.density);
    localStorage.setItem(STORAGE_KEYS.glassMode, prefs.glassMode);
    localStorage.setItem(STORAGE_KEYS.liteMode, String(Boolean(prefs.liteMode)));
    localStorage.setItem(STORAGE_KEYS.voiceConfirm, String(Boolean(prefs.voiceConfirm)));
    localStorage.setItem(STORAGE_KEYS.uiSounds, String(Boolean(prefs.uiSounds)));
    localStorage.setItem(STORAGE_KEYS.walkieChimes, String(Boolean(prefs.walkieChimes)));
  } catch {
    // ignore storage quota errors
  }
}

function syncDomAttributes({ effectiveTheme, resolvedMode, darkMode, isKioskLocked, prefs }) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;

  html.dataset.theme = effectiveTheme;
  html.dataset.mode = resolvedMode;
  html.dataset.font = prefs.fontFamily;
  html.dataset.density = prefs.density;
  html.dataset.glass = prefs.glassMode;
  if (isKioskLocked) {
    html.dataset.kiosk = 'true';
  } else {
    delete html.dataset.kiosk;
  }

  html.classList.toggle('dark', darkMode);
  html.classList.toggle('dark-theme', darkMode);
  html.classList.remove('scale-normal', 'scale-large', 'scale-xlarge');
  html.classList.add(prefs.fontScale);
  html.classList.toggle('lite-mode', Boolean(prefs.liteMode));
  html.style.colorScheme = resolvedMode;

  if (body) {
    body.classList.toggle('dark-theme', darkMode);
    body.classList.remove('font-cairo', 'font-ibm', 'font-tajawal', 'font-readex');
    if (prefs.fontFamily !== 'auto') {
      body.classList.add(`font-${prefs.fontFamily}`);
    }
  }

  const { color, isLightAppearance } = getThemeMetaColor(effectiveTheme, resolvedMode);
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) {
    metaEl.setAttribute('content', color);
  }
  try {
    window.ZayedAndroidBridge?.setSystemBars?.(color, isLightAppearance);
  } catch {
    // ignore if native bridge unavailable
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({
  isKioskLocked: isKioskLockedProp = false,
  onPrefsChange = null,
  children,
}) {
  const [prefs, setPrefs] = useState(readInitialPrefs);
  const [systemDark, setSystemDark] = useState(readSystemDark);
  const [kioskLockedState, setKioskLockedState] = useState(false);

  const onPrefsChangeRef = useRef(onPrefsChange);
  onPrefsChangeRef.current = onPrefsChange;

  const activeTransitionRef = useRef(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const effectiveKioskLocked = Boolean(isKioskLockedProp || kioskLockedState);
  const kioskRef = useRef(effectiveKioskLocked);
  kioskRef.current = effectiveKioskLocked;

  const setKioskLocked = useCallback((locked) => {
    setKioskLockedState(Boolean(locked));
  }, []);

  // Track OS dark mode changes when modePref === 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (ev) => setSystemDark(Boolean(ev.matches));
    setSystemDark(Boolean(mq.matches));
    if (mq.addEventListener) {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }
    mq.addListener?.(handleChange);
    return () => mq.removeListener?.(handleChange);
  }, []);

  // Kiosk Mode ALWAYS stays in bright glare-resistant Daylight Classic mode
  const resolvedMode = effectiveKioskLocked
    ? 'light'
    : prefs.modePref === 'system'
    ? systemDark
      ? 'dark'
      : 'light'
    : prefs.modePref;

  const effectiveTheme = effectiveKioskLocked ? 'classic' : prefs.theme;
  const darkMode = resolvedMode === 'dark';

  const architecture = useMemo(
    () => getThemeArchitecture(effectiveTheme),
    [effectiveTheme]
  );

  // Sync DOM attributes, legacy classes, theme-color meta, and Capacitor Android status bar
  useEffect(() => {
    syncDomAttributes({
      effectiveTheme,
      resolvedMode,
      darkMode,
      isKioskLocked: effectiveKioskLocked,
      prefs,
    });
    persistLocalPrefs(prefs);
  }, [effectiveTheme, resolvedMode, darkMode, effectiveKioskLocked, prefs]);

  const updatePrefs = useCallback((updater, { notifyServer = true } = {}) => {
    setPrefs((prev) => {
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      const next = { ...prev, ...patch };
      if (notifyServer && onPrefsChangeRef.current) {
        try {
          onPrefsChangeRef.current(next);
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  /**
   * Architectural Theme Transition:
   * - Tier 1: Native View Transitions API (`document.startViewTransition` + `flushSync`)
   *   providing a 220ms optical blur crossfade between completely distinct shell architectures.
   * - Tier 2: Atomic 1-frame hard style reset (`html.theme-switching`) for Chrome 64-110 / Lite Mode.
   */
  const applyThemeTransition = useCallback(
    (updater, { notifyServer = true } = {}) => {
      if (typeof document === 'undefined') {
        updatePrefs(updater, { notifyServer });
        return;
      }

      const currentPrefs = prefsRef.current;
      const canUseViewTransition =
        typeof document.startViewTransition === 'function' &&
        !currentPrefs.liteMode &&
        !kioskRef.current &&
        !prefersReducedMotion() &&
        !activeTransitionRef.current;

      if (canUseViewTransition) {
        activeTransitionRef.current = true;
        try {
          const transition = document.startViewTransition(() => {
            flushSync(() => {
              updatePrefs(updater, { notifyServer });
            });
          });
          Promise.resolve(transition?.finished)
            .catch(() => {})
            .finally(() => {
              activeTransitionRef.current = false;
            });
          return;
        } catch {
          activeTransitionRef.current = false;
        }
      }

      // Atomic 1-frame hard style reset fallback (zero muddy half-transition flicker)
      const html = document.documentElement;
      html.classList.add('theme-switching');
      updatePrefs(updater, { notifyServer });
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            html.classList.remove('theme-switching');
          });
        });
      } else {
        html.classList.remove('theme-switching');
      }
    },
    [updatePrefs]
  );

  const setTheme = useCallback(
    (id) => {
      markExplicitThemeV2();
      applyThemeTransition({ theme: normalizeThemeId(id) });
    },
    [applyThemeTransition]
  );

  const setModePref = useCallback(
    (mode) => applyThemeTransition({ modePref: normalizeModePref(mode) }),
    [applyThemeTransition]
  );

  const toggleDarkMode = useCallback(() => {
    applyThemeTransition((prev) => {
      const currentlyDark =
        prev.modePref === 'system' ? readSystemDark() : prev.modePref === 'dark';
      return { modePref: currentlyDark ? 'light' : 'dark' };
    });
  }, [applyThemeTransition]);

  const setFontFamily = useCallback(
    (font) => updatePrefs({ fontFamily: normalizeFontFamily(font) }),
    [updatePrefs]
  );

  const cycleFontFamily = useCallback(() => {
    const order = ['auto', 'cairo', 'ibm', 'tajawal', 'readex'];
    updatePrefs((prev) => {
      const idx = order.indexOf(prev.fontFamily);
      return { fontFamily: order[(idx + 1) % order.length] };
    });
  }, [updatePrefs]);

  const setFontScale = useCallback(
    (scale) => updatePrefs({ fontScale: normalizeFontScale(scale) }),
    [updatePrefs]
  );

  const cycleFontScale = useCallback(() => {
    updatePrefs((prev) => ({
      fontScale:
        prev.fontScale === 'scale-normal'
          ? 'scale-large'
          : prev.fontScale === 'scale-large'
          ? 'scale-xlarge'
          : 'scale-normal',
    }));
  }, [updatePrefs]);

  const setDensity = useCallback(
    (density) => updatePrefs({ density: normalizeDensity(density) }),
    [updatePrefs]
  );

  const setGlassMode = useCallback(
    (glass) => updatePrefs({ glassMode: normalizeGlassMode(glass) }),
    [updatePrefs]
  );

  const setLiteMode = useCallback(
    (enabled) =>
      updatePrefs((prev) => ({
        liteMode: typeof enabled === 'function' ? Boolean(enabled(prev.liteMode)) : Boolean(enabled),
      })),
    [updatePrefs]
  );

  const setVoiceConfirm = useCallback(
    (enabled) =>
      updatePrefs((prev) => ({
        voiceConfirm:
          typeof enabled === 'function' ? Boolean(enabled(prev.voiceConfirm)) : Boolean(enabled),
      })),
    [updatePrefs]
  );

  const setUiSounds = useCallback(
    (enabled) =>
      updatePrefs((prev) => ({
        uiSounds: typeof enabled === 'function' ? Boolean(enabled(prev.uiSounds)) : Boolean(enabled),
      })),
    [updatePrefs]
  );

  const setWalkieChimes = useCallback(
    (enabled) =>
      updatePrefs((prev) => ({
        walkieChimes:
          typeof enabled === 'function' ? Boolean(enabled(prev.walkieChimes)) : Boolean(enabled),
      })),
    [updatePrefs]
  );

  // Hydrate server-saved preferences (supports both canonical keys and `mode`/`reducedBlur` aliases)
  const applyServerPrefs = useCallback(
    (serverPrefs) => {
      if (!serverPrefs || typeof serverPrefs !== 'object') return;
      const patch = {};
      if (typeof serverPrefs.theme === 'string' && serverPrefs.theme.trim()) {
        patch.theme = normalizeThemeId(serverPrefs.theme.trim());
        markExplicitThemeV2();
      }
      if (serverPrefs.modePref !== undefined || serverPrefs.mode !== undefined) {
        patch.modePref = normalizeModePref(serverPrefs.modePref ?? serverPrefs.mode);
      }
      if (serverPrefs.fontFamily !== undefined) {
        patch.fontFamily = normalizeFontFamily(serverPrefs.fontFamily);
      }
      if (serverPrefs.fontScale !== undefined) {
        patch.fontScale = normalizeFontScale(serverPrefs.fontScale);
      }
      if (serverPrefs.density !== undefined) {
        patch.density = normalizeDensity(serverPrefs.density);
      }
      if (serverPrefs.glassMode !== undefined || serverPrefs.reducedBlur !== undefined) {
        patch.glassMode = normalizeGlassMode(serverPrefs.glassMode, serverPrefs.reducedBlur);
      }
      if (serverPrefs.liteMode !== undefined) patch.liteMode = Boolean(serverPrefs.liteMode);
      if (serverPrefs.voiceConfirm !== undefined) {
        patch.voiceConfirm = Boolean(serverPrefs.voiceConfirm);
      }
      if (serverPrefs.uiSounds !== undefined) patch.uiSounds = Boolean(serverPrefs.uiSounds);
      if (serverPrefs.walkieChimes !== undefined) {
        patch.walkieChimes = Boolean(serverPrefs.walkieChimes);
      }
      if (Object.keys(patch).length > 0) {
        updatePrefs(patch, { notifyServer: false });
      }
    },
    [updatePrefs]
  );

  const resetDisplayDefaults = useCallback(() => {
    applyThemeTransition({
      ...DEFAULT_DISPLAY_PREFS,
      liteMode: detectLowEndDevice(),
    });
  }, [applyThemeTransition]);

  const value = useMemo(
    () => ({
      theme: prefs.theme,
      effectiveTheme,
      themeMeta: THEME_MAP[effectiveTheme] || THEME_MAP.minimal,
      architecture,
      setTheme,
      modePref: prefs.modePref,
      setModePref,
      resolvedMode,
      darkMode,
      toggleDarkMode,
      fontFamily: prefs.fontFamily,
      setFontFamily,
      cycleFontFamily,
      fontScale: prefs.fontScale,
      setFontScale,
      cycleFontScale,
      density: prefs.density,
      setDensity,
      glassMode: prefs.glassMode,
      setGlassMode,
      liteMode: prefs.liteMode,
      setLiteMode,
      voiceConfirm: prefs.voiceConfirm,
      setVoiceConfirm,
      uiSounds: prefs.uiSounds,
      setUiSounds,
      walkieChimes: prefs.walkieChimes,
      setWalkieChimes,
      isKioskLocked: effectiveKioskLocked,
      setKioskLocked,
      preferences: prefs,
      applyServerPrefs,
      resetDisplayDefaults,
    }),
    [
      prefs,
      effectiveTheme,
      architecture,
      setTheme,
      setModePref,
      resolvedMode,
      darkMode,
      toggleDarkMode,
      setFontFamily,
      cycleFontFamily,
      setFontScale,
      cycleFontScale,
      setDensity,
      setGlassMode,
      setLiteMode,
      setVoiceConfirm,
      setUiSounds,
      setWalkieChimes,
      effectiveKioskLocked,
      setKioskLocked,
      applyServerPrefs,
      resetDisplayDefaults,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const FALLBACK_THEME_CTX = Object.freeze({
  ...DEFAULT_DISPLAY_PREFS,
  effectiveTheme: 'minimal',
  themeMeta: THEME_MAP.minimal,
  architecture: getThemeArchitecture('minimal'),
  resolvedMode: 'light',
  darkMode: false,
  isKioskLocked: false,
  preferences: DEFAULT_DISPLAY_PREFS,
  setTheme: () => {},
  setModePref: () => {},
  toggleDarkMode: () => {},
  setFontFamily: () => {},
  cycleFontFamily: () => {},
  setFontScale: () => {},
  cycleFontScale: () => {},
  setDensity: () => {},
  setGlassMode: () => {},
  setLiteMode: () => {},
  setVoiceConfirm: () => {},
  setUiSounds: () => {},
  setWalkieChimes: () => {},
  setKioskLocked: () => {},
  applyServerPrefs: () => {},
  resetDisplayDefaults: () => {},
});

export function useTheme() {
  const ctx = useContext(ThemeContext);
  return ctx || FALLBACK_THEME_CTX;
}

export function useThemeArchitecture() {
  const { architecture } = useTheme();
  return architecture || getThemeArchitecture('minimal');
}
