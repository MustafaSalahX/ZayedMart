/**
 * ZayedMart V2 — Architectural Theme Descriptors (Single Source of Truth)
 * Drives real structural shell switching across AppShell, AmbientBackdrop,
 * TopBar, BottomNav, and shared components/ui/* primitives without ad-hoc theme conditionals.
 */

export const THEME_ARCHITECTURES = Object.freeze({
  minimal: Object.freeze({
    id: 'minimal',
    shell: Object.freeze({
      headerLayout: 'minimal-slim',
      bottomNavLayout: 'minimal-hairline',
      headerDetached: false,
      bottomNavDetached: false,
      showBrandBar: false,
      showLogoBox: false,
      headerNavStyle: 'underline',
      bottomNavIndicator: 'dot',
      maxContentWidth: 'max-w-6xl',
      mainPaddingClass: 'px-4 sm:px-8 py-5 sm:py-7',
    }),
    backdrop: Object.freeze({
      variant: 'none',
      supportsGlass: false,
    }),
    surfaces: Object.freeze({
      architecture: 'flat-hairline',
      iconContainer: 'bare',
      kpiLayout: 'hairline-strip',
      filterRailStyle: 'underline',
      listDivider: 'divide-y divide-line-subtle',
      buttonRadius: 'rounded-[var(--g-radius-btn)]',
      headingWeight: 'font-semibold',
      labelWeight: 'font-medium',
      sectionGapClass: 'space-y-6',
    }),
    motion: Object.freeze({
      pressClass: 'active:scale-[0.985]',
      hoverLift: false,
    }),
  }),

  'liquid-glass': Object.freeze({
    id: 'liquid-glass',
    shell: Object.freeze({
      headerLayout: 'floating-glass-capsule',
      bottomNavLayout: 'floating-glass-dock',
      headerDetached: true,
      bottomNavDetached: true,
      showBrandBar: false,
      showLogoBox: false,
      headerNavStyle: 'liquid-pill',
      bottomNavIndicator: 'liquid-bubble',
      maxContentWidth: 'max-w-7xl',
      mainPaddingClass: 'px-3.5 sm:px-6 py-4 sm:py-6',
    }),
    backdrop: Object.freeze({
      variant: 'liquid-glass',
      supportsGlass: true,
    }),
    surfaces: Object.freeze({
      architecture: 'optical-glass',
      iconContainer: 'glass-orb',
      kpiLayout: 'glass-tiles',
      filterRailStyle: 'glass',
      listDivider: 'divide-y divide-[var(--g-border-subtle)]',
      buttonRadius: 'rounded-[var(--g-radius-btn)]',
      headingWeight: 'font-bold',
      labelWeight: 'font-semibold',
      sectionGapClass: 'space-y-5',
    }),
    motion: Object.freeze({
      pressClass: 'active:scale-[0.97]',
      hoverLift: true,
    }),
  }),

  elegant: Object.freeze({
    id: 'elegant',
    shell: Object.freeze({
      headerLayout: 'editorial-rule',
      bottomNavLayout: 'editorial-hairline',
      headerDetached: false,
      bottomNavDetached: false,
      showBrandBar: false,
      showLogoBox: false,
      headerNavStyle: 'editorial-underline',
      bottomNavIndicator: 'top-line',
      maxContentWidth: 'max-w-6xl',
      mainPaddingClass: 'px-4 sm:px-7 py-5 sm:py-7',
    }),
    backdrop: Object.freeze({
      variant: 'elegant-subtle',
      supportsGlass: false,
    }),
    surfaces: Object.freeze({
      architecture: 'editorial-hairline',
      iconContainer: 'hairline-frame',
      kpiLayout: 'editorial-strip',
      filterRailStyle: 'underline',
      listDivider: 'divide-y divide-line-subtle',
      buttonRadius: 'rounded-[var(--g-radius-btn)]',
      headingWeight: 'font-bold',
      labelWeight: 'font-semibold',
      sectionGapClass: 'space-y-5',
    }),
    motion: Object.freeze({
      pressClass: 'active:scale-[0.98]',
      hoverLift: false,
    }),
  }),

  modern: Object.freeze({
    id: 'modern',
    shell: Object.freeze({
      headerLayout: 'studio-segmented',
      bottomNavLayout: 'floating-studio-dock',
      headerDetached: false,
      bottomNavDetached: true,
      showBrandBar: false,
      showLogoBox: true,
      headerNavStyle: 'segmented-track',
      bottomNavIndicator: 'studio-tile',
      maxContentWidth: 'max-w-7xl',
      mainPaddingClass: 'px-3.5 sm:px-6 py-4 sm:py-5',
    }),
    backdrop: Object.freeze({
      variant: 'modern-spotlight',
      supportsGlass: false,
    }),
    surfaces: Object.freeze({
      architecture: 'tonal-studio',
      iconContainer: 'studio-tile',
      kpiLayout: 'studio-bento',
      filterRailStyle: 'studio',
      listDivider: 'divide-y divide-line-subtle',
      buttonRadius: 'rounded-[var(--g-radius-btn)]',
      headingWeight: 'font-bold',
      labelWeight: 'font-semibold',
      sectionGapClass: 'space-y-4',
    }),
    motion: Object.freeze({
      pressClass: 'active:scale-[0.975]',
      hoverLift: true,
    }),
  }),

  classic: Object.freeze({
    id: 'classic',
    shell: Object.freeze({
      headerLayout: 'classic-clean',
      bottomNavLayout: 'classic-m3-pill',
      headerDetached: false,
      bottomNavDetached: false,
      showBrandBar: true,
      showLogoBox: true,
      headerNavStyle: 'm3-pill',
      bottomNavIndicator: 'm3-pill',
      maxContentWidth: 'max-w-7xl',
      mainPaddingClass: 'px-3 sm:px-6 py-4 sm:py-5',
    }),
    backdrop: Object.freeze({
      variant: 'none',
      supportsGlass: false,
    }),
    surfaces: Object.freeze({
      architecture: 'm3-elevated',
      iconContainer: 'm3-tonal',
      kpiLayout: 'm3-cards',
      filterRailStyle: 'pill',
      listDivider: 'divide-y divide-line-subtle',
      buttonRadius: 'rounded-[var(--g-radius-btn)]',
      headingWeight: 'font-bold',
      labelWeight: 'font-semibold',
      sectionGapClass: 'space-y-4',
    }),
    motion: Object.freeze({
      pressClass: 'active:scale-[0.97]',
      hoverLift: true,
    }),
  }),
});

export function getThemeArchitecture(themeId) {
  return THEME_ARCHITECTURES[themeId] || THEME_ARCHITECTURES.classic;
}
