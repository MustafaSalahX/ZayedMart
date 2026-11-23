import React from 'react';
import Icon from './ui/Icon.jsx';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error: error || new Error('Unexpected UI error'),
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ZayedMart ErrorBoundary]', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    this.props.onReset?.();
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const errorMsg = this.state.error?.message || String(this.state.error || '');
    const componentStack = this.state.errorInfo?.componentStack || this.state.error?.stack || '';

    return (
      <div
        dir="rtl"
        lang="ar"
        className="min-h-[100dvh] w-full bg-[var(--g-bg,#F8FAFD)] text-[var(--g-text,#1A1D21)] flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-[var(--g-radius-card,12px)] bg-[var(--g-surface,#FFFFFF)] border border-[var(--g-border,#D5DCE6)] p-6 text-center space-y-4">
          <Icon
            name="error_outline"
            size={32}
            className="text-[var(--g-red,#B3261E)] mx-auto"
          />

          <div className="space-y-1">
            <h1 className="text-base sm:text-lg font-semibold m-0">
              حدث خطأ غير متوقع
            </h1>
            <p className="text-xs sm:text-sm font-normal text-[var(--g-muted,#52575C)] m-0 leading-relaxed">
              بياناتك محفوظة — أعد المحاولة أو حدّث الصفحة.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex-1 min-h-[44px] px-4 py-2 rounded-[var(--g-radius-btn,10px)] bg-[var(--g-primary-solid,#0B57D0)] text-[var(--g-on-primary,#FFFFFF)] text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform duration-150"
            >
              <Icon name="replay" size={18} />
              <span>إعادة المحاولة</span>
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 min-h-[44px] px-4 py-2 rounded-[var(--g-radius-btn,10px)] bg-[var(--g-surface-variant,#EDF2FA)] border border-[var(--g-border,#D5DCE6)] text-[var(--g-text,#1A1D21)] text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform duration-150"
            >
              <Icon name="refresh" size={18} />
              <span>تحديث</span>
            </button>
          </div>

          {(errorMsg || componentStack) && (
            <div className="pt-2 border-t border-[var(--g-border,#D5DCE6)] text-start">
              <button
                type="button"
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                className="text-xs font-medium text-[var(--g-muted,#52575C)] hover:text-[var(--g-text,#1A1D21)] flex items-center gap-1 mx-auto"
              >
                <Icon
                  name={this.state.showDetails ? 'expand_less' : 'expand_more'}
                  size={16}
                />
                <span>{this.state.showDetails ? 'إخفاء التفاصيل' : 'التفاصيل التقنية'}</span>
              </button>

              {this.state.showDetails && (
                <pre
                  dir="ltr"
                  className="mt-2.5 p-3 rounded-lg bg-[var(--g-surface-variant,#EDF2FA)] border border-[var(--g-border,#D5DCE6)] text-[11px] text-left overflow-x-auto max-h-44 whitespace-pre-wrap break-words text-[var(--g-muted,#52575C)]"
                >
                  {errorMsg}
                  {componentStack ? `\n${componentStack}` : ''}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}
