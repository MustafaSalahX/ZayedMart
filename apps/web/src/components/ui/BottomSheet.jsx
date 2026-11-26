import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

let openSheetCounter = 0;
let savedBodyOverflow = '';

/**
 * Global Modal Layer Tracker:
 * - Coordinates stacked sheet z-indexes (`62, 64, 66...`) cleanly
 * - Toggles `html[data-modal-open="true"]` so `.g-floating-chrome` docks/FABs auto-hide
 * - Locks body scroll safely until the last overlay closes
 */
export function pushModalLayer() {
  openSheetCounter += 1;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.modalOpen = 'true';
    if (openSheetCounter === 1) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }
  return 60 + openSheetCounter * 2;
}

export function popModalLayer() {
  openSheetCounter = Math.max(0, openSheetCounter - 1);
  if (typeof document !== 'undefined' && openSheetCounter === 0) {
    delete document.documentElement.dataset.modalOpen;
    document.body.style.overflow = savedBodyOverflow || '';
    savedBodyOverflow = '';
  }
}

const SWIPE_DISMISS_DISTANCE = 96;
const SWIPE_DISMISS_VELOCITY = 0.45;
const MOBILE_BREAKPOINT_PX = 640;

/**
 * Unified Mobile Bottom Sheet / Desktop Centered Dialog backed by `@radix-ui/react-dialog`:
 * - Portals via Radix `Dialog.Portal` so ancestor stacking contexts NEVER trap it
 * - Synced with `pushModalLayer()` / `popModalLayer()` for `html[data-modal-open="true"]` & stacked z-index
 * - Mobile (`< 640px`) touch swipe-down-to-dismiss gesture on the drag handle/header ONLY
 * - Pinned header + sticky footer stay visible above the Android virtual keyboard (IME)
 */
export default function BottomSheet({
  open,
  onClose,
  title = '',
  subtitle = '',
  badge = null,
  maxWidth = 'max-w-lg',
  footer = null,
  closeOnOverlay = true,
  children,
}) {
  const arch = useThemeArchitecture();
  const [layerZ, setLayerZ] = useState(62);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [springBack, setSpringBack] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dragRef = useRef({
    active: false,
    pointerId: null,
    startY: 0,
    captured: false,
    samples: [],
  });

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setIsDragging(false);
      setSpringBack(false);
      dragRef.current.active = false;
      dragRef.current.pointerId = null;
      dragRef.current.captured = false;
      return undefined;
    }

    const z = pushModalLayer();
    setLayerZ(z);

    return () => {
      popModalLayer();
    };
  }, [open]);

  useEffect(() => {
    if (!springBack) return undefined;
    const timer = setTimeout(() => setSpringBack(false), 230);
    return () => clearTimeout(timer);
  }, [springBack]);

  const handleHeaderPointerDown = (e) => {
    if (!onCloseRef.current) return;
    if (typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT_PX) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (
      e.target instanceof Element &&
      e.target.closest('button, a, input, select, textarea, [role="button"]')
    ) {
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      captured: false,
      samples: [{ y: e.clientY, t: now }],
    };
  };

  const handleHeaderPointerMove = (e) => {
    const state = dragRef.current;
    if (!state.active || state.pointerId !== e.pointerId) return;

    const dy = Math.max(0, e.clientY - state.startY);
    if (!state.captured && dy > 4) {
      state.captured = true;
      setSpringBack(false);
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore synthetic events without active pointer
      }
    }

    if (state.captured) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      state.samples.push({ y: e.clientY, t: now });
      if (state.samples.length > 8) {
        state.samples.shift();
      }
      setDragY(dy);
    }
  };

  const finishHeaderDrag = (e, canceled) => {
    const state = dragRef.current;
    if (!state.active || state.pointerId !== e.pointerId) return;

    const wasCaptured = state.captured;
    const samples = state.samples;
    state.active = false;
    state.pointerId = null;
    state.captured = false;

    if (wasCaptured) {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    }

    if (!wasCaptured) return;

    setIsDragging(false);

    const dy = Math.max(0, e.clientY - state.startY);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const refSample =
      samples.find((s) => now - s.t <= 120) ||
      samples[0] || { y: state.startY, t: now };
    const dt = Math.max(1, now - refSample.t);
    const velocity = Math.max(0, (e.clientY - refSample.y) / dt);

    if (!canceled && (dy >= SWIPE_DISMISS_DISTANCE || (dy >= 20 && velocity > SWIPE_DISMISS_VELOCITY))) {
      setDragY(0);
      setSpringBack(false);
      onCloseRef.current?.();
      return;
    }

    setSpringBack(true);
    setDragY(0);
  };

  const contentStyle = isDragging
    ? { transform: `translate3d(0, ${dragY}px, 0)`, transition: 'none' }
    : springBack
    ? { transform: 'translate3d(0, 0, 0)', transition: 'transform 220ms var(--g-ease-out)' }
    : undefined;

  return (
    <Dialog.Root
      open={Boolean(open)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCloseRef.current?.();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ zIndex: layerZ }}
          className="g-modal-overlay g-radix-overlay"
        >
          <Dialog.Content
            style={contentStyle}
            onPointerDownOutside={(e) => {
              if (!closeOnOverlay) {
                e.preventDefault();
              }
            }}
            onInteractOutside={(e) => {
              if (!closeOnOverlay) {
                e.preventDefault();
              }
            }}
            onEscapeKeyDown={(e) => {
              if (!onCloseRef.current) {
                e.preventDefault();
              }
            }}
            className={cn(
              'g-dialog-sheet g-dialog-sheet-sticky g-radix-dialog gap-3 focus:outline-none',
              maxWidth
            )}
          >
            <div
              onPointerDown={handleHeaderPointerDown}
              onPointerMove={handleHeaderPointerMove}
              onPointerUp={(e) => finishHeaderDrag(e, false)}
              onPointerCancel={(e) => finishHeaderDrag(e, true)}
              className="shrink-0 touch-none sm:touch-auto"
            >
              <div className="g-sheet-handle" aria-hidden="true" />

              {!title && (
                <Dialog.Title className="sr-only">نافذة إجراءات</Dialog.Title>
              )}

              {(title || onClose) && (
                <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-line">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {title && (
                        <Dialog.Title
                          className={cn(
                            'text-sm sm:text-base tracking-tight text-ink m-0 truncate',
                            arch.surfaces.headingWeight
                          )}
                        >
                          {title}
                        </Dialog.Title>
                      )}
                      {badge}
                    </div>
                    {subtitle && (
                      <Dialog.Description className="text-xs font-normal text-ink-muted m-0 mt-0.5 truncate">
                        {subtitle}
                      </Dialog.Description>
                    )}
                  </div>

                  {onClose && (
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label="إغلاق"
                        className="w-11 h-11 rounded-full bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center shrink-0 transition-[background-color,color,transform] duration-150 ease-[var(--g-ease-out)] active:scale-95"
                      >
                        <Icon name="close" size={20} />
                      </button>
                    </Dialog.Close>
                  )}
                </div>
              )}
            </div>

            <div className="g-dialog-body pe-0.5">{children}</div>

            {footer && (
              <div className="pt-3 border-t border-line shrink-0">{footer}</div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
