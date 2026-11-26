/**
 * ZayedMart V2 Theme & Display Registry — Single Source of Truth
 * 5 Mastercrafted Architectural Themes × Light & Dark (10 WCAG-verified palettes)
 * with safe legacy alias migration for removed bonus themes.
 */

export const LEGACY_THEME_MAP = Object.freeze({
  nordic: 'minimal',
  'cyber-ops': 'modern',
  'desert-sand': 'elegant',
});

export const THEMES_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'minimal',
    nameAr: 'البساطة',
    nameEn: 'Minimal',
    category: 'core',
    isDefault: true,
    defaultFont: 'ibm',
    supportsGlass: false,
    metaLight: '#FFFFFF',
    metaDark: '#09090B',
    lightStatusBar: true,
    swatches: Object.freeze({
      light: ['#FFFFFF', '#F4F4F5', '#18181B', '#24592E'],
      dark: ['#09090B', '#18181B', '#FAFAFA', '#86D49B'],
    }),
  }),
  Object.freeze({
    id: 'classic',
    nameAr: 'كلاسيك',
    nameEn: 'Classic',
    category: 'core',
    defaultFont: 'cairo',
    supportsGlass: false,
    metaLight: '#F8FAFD',
    metaDark: '#131416',
    lightStatusBar: true,
    swatches: Object.freeze({
      light: ['#F8FAFD', '#FFFFFF', '#0B57D0', '#146C2E'],
      dark: ['#131416', '#1D1F22', '#9FC5FF', '#81C995'],
    }),
  }),
  Object.freeze({
    id: 'liquid-glass',
    nameAr: 'الزجاج السائل',
    nameEn: 'Liquid Glass',
    category: 'core',
    defaultFont: 'readex',
    supportsGlass: true,
    metaLight: '#DCEEFF',
    metaDark: '#040B1A',
    lightStatusBar: true,
    swatches: Object.freeze({
      light: ['#DCEEFF', '#F4F9FF', '#005CC8', '#2DD4BF'],
      dark: ['#040B1A', '#101B30', '#96D0FF', '#82F0FC'],
    }),
  }),
  Object.freeze({
    id: 'elegant',
    nameAr: 'الفاخر',
    nameEn: 'Elegant',
    category: 'core',
    defaultFont: 'tajawal',
    supportsGlass: false,
    metaLight: '#FAF7F2',
    metaDark: '#110E0C',
    lightStatusBar: true,
    swatches: Object.freeze({
      light: ['#FAF7F2', '#FFFFFF', '#134E39', '#865D10'],
      dark: ['#110E0C', '#1A1613', '#E6C06C', '#196B4C'],
    }),
  }),
  Object.freeze({
    id: 'modern',
    nameAr: 'العصري',
    nameEn: 'Modern',
    category: 'core',
    defaultFont: 'ibm',
    supportsGlass: false,
    metaLight: '#F6F7FA',
    metaDark: '#0B0E14',
    lightStatusBar: true,
    swatches: Object.freeze({
      light: ['#F6F7FA', '#FFFFFF', '#1D4ED8', '#0F766E'],
      dark: ['#0B0E14', '#121722', '#60A5FA', '#2DD4BF'],
    }),
  }),
]);

export const THEME_LIST = THEMES_REGISTRY;

export const THEME_MAP = Object.freeze(
  THEMES_REGISTRY.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {})
);

export const VALID_THEME_IDS = THEMES_REGISTRY.map((t) => t.id);

export const MODE_OPTIONS = Object.freeze([
  { id: 'light', labelAr: 'نهاري', icon: 'light_mode' },
  { id: 'dark', labelAr: 'ليلي', icon: 'dark_mode' },
  { id: 'system', labelAr: 'تلقائي', icon: 'contrast' },
]);

export const FONT_OPTIONS = Object.freeze([
  { id: 'auto', labelAr: 'تلقائي', sample: 'زايد مارت 123' },
  { id: 'cairo', labelAr: 'Cairo', sample: 'زايد مارت 123' },
  { id: 'ibm', labelAr: 'IBM Plex', sample: 'زايد مارت 123' },
  { id: 'tajawal', labelAr: 'Tajawal', sample: 'زايد مارت 123' },
  { id: 'readex', labelAr: 'Readex Pro', sample: 'زايد مارت 123' },
]);

export const SCALE_OPTIONS = Object.freeze([
  { id: 'scale-normal', labelAr: 'عادي', sizeLabel: '100%' },
  { id: 'scale-large', labelAr: 'كبير', sizeLabel: '110%' },
  { id: 'scale-xlarge', labelAr: 'ضخم', sizeLabel: '120%' },
]);

export const DENSITY_OPTIONS = Object.freeze([
  { id: 'comfortable', labelAr: 'مريح', icon: 'view_agenda' },
  { id: 'compact', labelAr: 'مكثّف', icon: 'view_headline' },
]);

export const GLASS_OPTIONS = Object.freeze([
  { id: 'auto', labelAr: 'كامل', icon: 'blur_on' },
  { id: 'reduced', labelAr: 'خفيف', icon: 'blur_linear' },
  { id: 'off', labelAr: 'مغلق', icon: 'blur_off' },
]);

export const DEFAULT_DISPLAY_PREFS = Object.freeze({
  theme: 'minimal',
  modePref: 'light',
  fontFamily: 'auto',
  fontScale: 'scale-normal',
  density: 'comfortable',
  glassMode: 'auto',
  liteMode: false,
  voiceConfirm: true,
  uiSounds: true,
  walkieChimes: true,
});

export function normalizeThemeId(value) {
  if (typeof value !== 'string') return 'minimal';
  const mapped = LEGACY_THEME_MAP[value] || value;
  return THEME_MAP[mapped] ? mapped : 'minimal';
}

export function normalizeModePref(value) {
  if (value === 'dark' || value === 'light' || value === 'system') return value;
  return 'light';
}

export function normalizeFontFamily(value) {
  if (value === 'ibm-plex') return 'ibm';
  if (['auto', 'cairo', 'ibm', 'tajawal', 'readex'].includes(value)) return value;
  return 'auto';
}

export function normalizeFontScale(value) {
  if (['scale-normal', 'scale-large', 'scale-xlarge'].includes(value)) return value;
  return 'scale-normal';
}

export function normalizeDensity(value) {
  return value === 'compact' ? 'compact' : 'comfortable';
}

export function normalizeGlassMode(value, reducedBlurAlias) {
  if (value === 'full') return 'auto';
  if (['auto', 'reduced', 'off'].includes(value)) return value;
  if (reducedBlurAlias === true) return 'reduced';
  return 'auto';
}

export function getThemeMetaColor(themeId, resolvedMode) {
  const meta = THEME_MAP[normalizeThemeId(themeId)] || THEME_MAP.minimal;
  const isDark = resolvedMode === 'dark';
  return {
    color: isDark ? meta.metaDark : meta.metaLight,
    isLightAppearance: !isDark && Boolean(meta.lightStatusBar),
  };
}
