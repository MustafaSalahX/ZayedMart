import React from 'react';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import AmbientBackdrop from './AmbientBackdrop.jsx';

/**
 * Adaptive Architectural Shell Container (<AppShell />):
 * - Mounts <AmbientBackdrop /> as an un-trapped fixed `z-0` sibling so `position: sticky`
 *   headers and `position: fixed` docks/sheets/toasts NEVER get trapped in a backdrop-filter
 *   or transform stacking context.
 * - Automatically adapts `<main>` content measure, vertical rhythm, and bottom clearance
 *   across all 5 mastercrafted theme architectures.
 */
export default function AppShell({
  hasBottomNav = false,
  header = null,
  footer = null,
  mainClassName = '',
  children,
}) {
  const arch = useThemeArchitecture();
  const maxWidthCls = arch.shell.maxContentWidth || 'max-w-7xl';
  const paddingCls = arch.shell.mainPaddingClass || 'px-3 sm:px-6 py-4 sm:py-5';

  return (
    <>
      <AmbientBackdrop />
      <div
        data-shell-header={arch.shell.headerLayout}
        data-shell-dock={arch.shell.bottomNavLayout}
        className={`min-h-[100dvh] w-full flex flex-col overflow-x-hidden ${
          hasBottomNav
            ? 'pb-[calc(var(--bottom-nav-h)+5.25rem)] md:pb-24'
            : 'pb-[calc(5.25rem+var(--safe-bottom))] md:pb-24'
        }`}
      >
        {header}

        <main
          className={`relative flex-1 w-full mx-auto ${maxWidthCls} ${paddingCls} ${mainClassName}`}
        >
          {children}
        </main>

        {footer}
      </div>
    </>
  );
}
