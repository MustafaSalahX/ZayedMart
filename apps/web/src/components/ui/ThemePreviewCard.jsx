import React from 'react';
import Icon from './Icon.jsx';

/**
 * Pure Geometric Architectural Wireframe Thumbnail + 1–2 Word Theme Name ONLY.
 * - Zero fake Arabic text pills inside the thumbnail, zero taglines, zero marketing badges!
 * - Each of the 5 themes renders its genuine structural chrome & surface geometry via
 *   scoped live CSS variables (`data-theme` + `data-mode`).
 */
export default function ThemePreviewCard({
  theme,
  previewMode = 'light',
  selected = false,
  onSelect,
  className = '',
}) {
  if (!theme) return null;

  const isMinimal = theme.id === 'minimal';
  const isGlass = theme.id === 'liquid-glass';
  const isElegant = theme.id === 'elegant';
  const isModern = theme.id === 'modern';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect?.(theme.id)}
      className={`group text-start w-full rounded-[var(--g-radius-md)] p-2 border transition-[transform,border-color,background-color] duration-150 ease-[var(--g-ease-out)] cursor-pointer active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)] ${
        selected
          ? 'border-primary bg-surface-tint ring-1 ring-[var(--g-primary)]'
          : 'border-line bg-surface hover:border-line-strong'
      } ${className}`}
    >
      {/* Pure Geometric Live Scoped Architectural Thumbnail (Zero Text Inside) */}
      <div
        data-theme={theme.id}
        data-mode={previewMode}
        style={{
          backgroundColor: 'var(--g-bg)',
          backgroundImage: 'var(--g-bg-mesh)',
          borderColor: 'var(--g-border)',
        }}
        className="w-full h-[86px] rounded-[calc(var(--g-radius-md)-2px)] border overflow-hidden flex flex-col justify-between relative mb-2"
        aria-hidden="true"
      >
        {isMinimal ? (
          <div className="flex-1 min-h-0 flex flex-col justify-between">
            <div className="flex-1 min-h-0 flex">
              {/* Collapsible RTL Sidebar Rail */}
              <div
                style={{
                  backgroundColor: 'var(--g-sidebar-bg, var(--g-surface-variant))',
                  borderColor: 'var(--g-sidebar-border, var(--g-border))',
                }}
                className="w-6 shrink-0 border-e px-1 py-1.5 flex flex-col justify-between"
              >
                <div className="space-y-1">
                  <span
                    style={{ backgroundColor: 'var(--g-primary-solid)' }}
                    className="block w-2.5 h-2.5 rounded-[3px] mx-auto"
                  />
                  <span
                    style={{
                      backgroundColor: 'var(--g-sidebar-accent, var(--g-surface-variant))',
                      borderColor: 'var(--g-border)',
                    }}
                    className="w-full h-1.5 rounded-[2px] border flex items-center justify-center"
                  >
                    <span
                      style={{ backgroundColor: 'var(--g-text)', opacity: 0.85 }}
                      className="w-2.5 h-0.5 rounded-full"
                    />
                  </span>
                  <span
                    style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                    className="block w-3 h-0.5 rounded-full mx-auto"
                  />
                  <span
                    style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                    className="block w-3 h-0.5 rounded-full mx-auto"
                  />
                </div>
                <span
                  style={{ backgroundColor: 'var(--g-border-strong)', opacity: 0.55 }}
                  className="block w-2 h-2 rounded-full mx-auto"
                />
              </div>

              {/* Slim Header + Rounded Zinc Dashboard-01 Cards */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div
                  style={{ borderBottomColor: 'var(--g-border)' }}
                  className="h-3.5 border-b px-2 flex items-center justify-between"
                >
                  <div className="flex items-center gap-1">
                    <span
                      style={{ backgroundColor: 'var(--g-muted)', opacity: 0.5 }}
                      className="w-1.5 h-1.5 rounded-[2px]"
                    />
                    <span
                      style={{ backgroundColor: 'var(--g-text)', opacity: 0.8 }}
                      className="w-5 h-1 rounded-full"
                    />
                  </div>
                  <span
                    style={{ backgroundColor: 'var(--g-muted)', opacity: 0.45 }}
                    className="w-1.5 h-1.5 rounded-full"
                  />
                </div>

                <div className="px-1.5 py-1.5 grid grid-cols-2 gap-1 flex-1 items-center">
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'var(--g-surface)',
                        borderColor: 'var(--g-border)',
                        boxShadow: 'var(--g-shadow-sm)',
                      }}
                      className="h-9 rounded-[5px] border p-1.5 flex flex-col justify-between"
                    >
                      <span
                        style={{ backgroundColor: 'var(--g-muted)', opacity: 0.45 }}
                        className="w-4 h-1 rounded-full"
                      />
                      <span
                        style={{ backgroundColor: 'var(--g-text)', opacity: 0.85 }}
                        className="w-6 h-1.5 rounded-[2px]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Dock */}
            <div
              style={{
                backgroundColor: 'var(--g-bg)',
                borderTopColor: 'var(--g-border)',
              }}
              className="h-3 border-t px-4 flex items-center justify-around shrink-0"
            >
              <span
                style={{
                  backgroundColor: 'var(--g-surface-variant)',
                  borderColor: 'var(--g-border)',
                }}
                className="w-3.5 h-1.5 rounded-[3px] border flex items-center justify-center"
              >
                <span
                  style={{ backgroundColor: 'var(--g-text)', opacity: 0.85 }}
                  className="w-1.5 h-0.5 rounded-full"
                />
              </span>
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                className="w-1.5 h-1 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                className="w-1.5 h-1 rounded-full"
              />
            </div>
          </div>
        ) : (
          <>
            {/* 1. Theme-Specific Header Wireframe */}
            {isGlass ? (
          <div className="px-2 pt-2">
            <div
              style={{
                backgroundColor: 'var(--g-surface-glass-strong)',
                borderColor: 'var(--g-glass-border)',
                boxShadow: 'var(--g-glass-specular)',
              }}
              className="h-3.5 rounded-full border px-2 flex items-center justify-between"
            >
              <span
                style={{ backgroundColor: 'var(--g-text)', opacity: 0.7 }}
                className="w-6 h-1 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-glass-pill-active)' }}
                className="w-5 h-2 rounded-full"
              />
            </div>
          </div>
        ) : isElegant ? (
          <div>
            <div className="h-4 px-2.5 flex items-center justify-between">
              <span
                style={{ backgroundColor: 'var(--g-text)', opacity: 0.8 }}
                className="w-5 h-1 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-accent)', opacity: 0.9 }}
                className="w-4 h-1 rounded-full"
              />
            </div>
            <div
              style={{
                background:
                  'linear-gradient(90deg, transparent, var(--g-accent), transparent)',
              }}
              className="h-px w-full opacity-80"
            />
          </div>
        ) : isModern ? (
          <div
            style={{
              backgroundColor: 'var(--g-surface)',
              borderBottomColor: 'var(--g-border-subtle)',
            }}
            className="h-4.5 border-b px-2 flex items-center justify-between"
          >
            <span
              style={{ backgroundColor: 'var(--g-primary-solid)' }}
              className="w-2.5 h-2.5 rounded-[3px]"
            />
            <div
              style={{
                backgroundColor: 'var(--g-surface-variant)',
                borderColor: 'var(--g-border)',
              }}
              className="h-2.5 px-0.5 rounded-[4px] border flex items-center gap-0.5"
            >
              <span
                style={{ backgroundColor: 'var(--g-surface)' }}
                className="w-4 h-1.5 rounded-[2px]"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                className="w-3 h-1 rounded-full"
              />
            </div>
            <span
              style={{ backgroundColor: 'var(--g-border-strong)', opacity: 0.5 }}
              className="w-2.5 h-2.5 rounded-full"
            />
          </div>
        ) : (
          <div>
            <div
              style={{
                height: '2px',
                backgroundColor: 'var(--g-primary-solid)',
              }}
            />
            <div
              style={{
                backgroundColor: 'var(--g-surface)',
                borderBottomColor: 'var(--g-border)',
              }}
              className="h-3.5 border-b px-2 flex items-center justify-between"
            >
              <span
                style={{ backgroundColor: 'var(--g-primary-solid)' }}
                className="w-2.5 h-2.5 rounded-[4px]"
              />
              <span
                style={{ backgroundColor: 'var(--g-secondary-container)' }}
                className="w-6 h-2 rounded-full"
              />
            </div>
          </div>
        )}

            {/* 2. Theme-Specific Content Surface Wireframe */}
            {isGlass ? (
          <div className="px-2 py-1.5 grid grid-cols-2 gap-1.5 flex-1 items-center">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: 'var(--g-surface-glass)',
                  borderColor: 'var(--g-glass-border)',
                  boxShadow: 'var(--g-glass-specular)',
                }}
                className="h-9 rounded-[10px] border p-1.5 flex flex-col justify-between"
              >
                <span
                  style={{ backgroundColor: 'var(--g-muted)', opacity: 0.45 }}
                  className="w-5 h-1 rounded-full"
                />
                <span
                  style={{
                    backgroundColor: idx === 0 ? 'var(--g-primary)' : 'var(--g-text)',
                    opacity: 0.8,
                  }}
                  className="w-7 h-2 rounded-full"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 py-1.5 grid grid-cols-2 gap-1.5 flex-1 items-center">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: 'var(--g-surface)',
                  borderColor: 'var(--g-border)',
                  borderRadius: 'var(--g-radius-sm)',
                }}
                className="h-8 border p-1.5 flex flex-col justify-between"
              >
                <span
                  style={{ backgroundColor: 'var(--g-muted)', opacity: 0.4 }}
                  className="w-5 h-1 rounded-full"
                />
                <span
                  style={{
                    backgroundColor: idx === 0 ? 'var(--g-primary)' : 'var(--g-accent)',
                    opacity: 0.85,
                  }}
                  className="w-7 h-1.5 rounded-full"
                />
              </div>
            ))}
          </div>
        )}

            {/* 3. Theme-Specific Bottom Dock Wireframe */}
            {isGlass ? (
          <div className="px-3 pb-1.5">
            <div
              style={{
                backgroundColor: 'var(--g-surface-glass-strong)',
                borderColor: 'var(--g-glass-border)',
                boxShadow: 'var(--g-glass-specular)',
              }}
              className="h-3 rounded-full border px-2 flex items-center justify-around"
            >
              <span
                style={{ backgroundColor: 'var(--g-glass-pill-active)' }}
                className="w-4 h-1.5 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.45 }}
                className="w-2 h-1 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.45 }}
                className="w-2 h-1 rounded-full"
              />
            </div>
          </div>
        ) : isModern ? (
          <div className="px-3 pb-1.5">
            <div
              style={{
                backgroundColor: 'var(--g-surface)',
                borderColor: 'var(--g-border)',
              }}
              className="h-3 rounded-[6px] border px-2 flex items-center justify-around"
            >
              <span
                style={{ backgroundColor: 'var(--g-primary-solid)' }}
                className="w-3.5 h-1.5 rounded-[3px]"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                className="w-2 h-1 rounded-full"
              />
              <span
                style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
                className="w-2 h-1 rounded-full"
              />
            </div>
          </div>
        ) : isElegant ? (
          <div
            style={{ borderTopColor: 'var(--g-border)' }}
            className="h-3 border-t px-4 flex items-center justify-around relative"
          >
            <span
              style={{ backgroundColor: 'var(--g-accent)' }}
              className="w-4 h-[2px] rounded-full"
            />
            <span
              style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
              className="w-2 h-1 rounded-full"
            />
            <span
              style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
              className="w-2 h-1 rounded-full"
            />
          </div>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--g-surface)',
              borderTopColor: 'var(--g-border)',
            }}
            className="h-3 border-t px-4 flex items-center justify-around"
          >
            <span
              style={{ backgroundColor: 'var(--g-secondary-container)' }}
              className="w-4 h-1.5 rounded-full"
            />
            <span
              style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
              className="w-2 h-1 rounded-full"
            />
            <span
              style={{ backgroundColor: 'var(--g-muted)', opacity: 0.35 }}
              className="w-2 h-1 rounded-full"
            />
          </div>
        )}
          </>
        )}
      </div>

      {/* Minimal Footer: 1–2 Word Theme Name + Optional Default Tag + Active Check ONLY */}
      <div className="flex items-center justify-between gap-1.5 px-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-ink truncate">
            {theme.nameAr}
          </span>
          {theme.isDefault && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-surface-2 border border-line text-[10px] font-medium text-ink-muted leading-none shrink-0">
              افتراضي
            </span>
          )}
        </div>
        <span
          aria-hidden="true"
          className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 ${
            selected
              ? 'bg-primary-solid text-on-primary'
              : 'border border-line text-transparent'
          }`}
        >
          <Icon name="check" size={10} weight="bold" />
        </span>
      </div>
    </button>
  );
}
