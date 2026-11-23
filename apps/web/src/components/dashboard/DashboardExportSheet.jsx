import React, { useMemo, useState } from 'react';
import {
  BottomSheet,
  Button,
  GroupedList,
  GroupedRow,
  Icon,
  SegmentedControl,
} from '../ui/index.js';
import {
  buildAttendanceWhatsAppText,
  buildWhatsAppSummaryText,
  exportDailyReportCsv,
  exportDailyReportWord,
  openWhatsAppShare,
} from '../../lib/exportUtils.js';

/**
 * Clean Apple-style Grouped Export & Share BottomSheet (`تصدير اليوم`).
 * Zero tinted promo cards, zero icon-in-colored-square boxes, zero explanatory prose.
 */
export default function DashboardExportSheet({
  open,
  onClose,
  data,
  initialPreviewMode = 'summary',
  onToast,
}) {
  const [previewMode, setPreviewMode] = useState(initialPreviewMode || 'summary');
  const [showPreviewText, setShowPreviewText] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [copying, setCopying] = useState(false);

  const previewText = useMemo(() => {
    if (!data) return '';
    return previewMode === 'attendance'
      ? buildAttendanceWhatsAppText(data)
      : buildWhatsAppSummaryText(data);
  }, [data, previewMode]);

  async function copyToClipboardSafe(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback for HTTP LAN / restricted Android WebView
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  async function handleCopyText(customText) {
    setCopying(true);
    try {
      const target = typeof customText === 'string' ? customText : previewText;
      const ok = await copyToClipboardSafe(target);
      if (ok) {
        onToast?.('تم نسخ التقرير للحافظة');
      } else {
        onToast?.('تعذر النسخ التلقائي — انسخ النص من المعاينة', 'error');
        setShowPreviewText(true);
      }
    } finally {
      setCopying(false);
    }
  }

  async function handleShareWhatsApp(mode = 'summary') {
    const text =
      mode === 'attendance'
        ? buildAttendanceWhatsAppText(data)
        : buildWhatsAppSummaryText(data);
    await copyToClipboardSafe(text);
    onToast?.('تم نسخ التقرير وفتح واتساب');
    openWhatsAppShare(text);
  }

  async function handleDownloadExcel() {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      await exportDailyReportCsv(data);
      onToast?.('تم تحميل ملف Excel');
    } catch (err) {
      onToast?.(err?.message || 'تعذر تصدير Excel', 'error');
    } finally {
      setExportingExcel(false);
    }
  }

  function handleDownloadWord() {
    if (exportingWord) return;
    setExportingWord(true);
    try {
      exportDailyReportWord(data);
      onToast?.('تم تحميل ملف Word');
    } catch (err) {
      onToast?.(err?.message || 'تعذر تصدير Word', 'error');
    } finally {
      setExportingWord(false);
    }
  }

  const dateKey = data?.dateKey || '';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="تصدير اليوم"
      subtitle={dateKey}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={showPreviewText ? 'visibility_off' : 'visibility'}
            onClick={() => setShowPreviewText((v) => !v)}
          >
            {showPreviewText ? 'إخفاء المعاينة' : 'معاينة'}
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <GroupedList>
          <GroupedRow onClick={() => handleShareWhatsApp('summary')}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon name="send" size={18} className="text-[var(--g-whatsapp)] shrink-0" />
              <span className="text-sm font-medium text-ink truncate">
                واتساب — ملخص اليوم
              </span>
            </div>
            <Icon
              name="chevron_left"
              size={18}
              className="text-ink-muted opacity-65 ltr:rotate-180 shrink-0"
            />
          </GroupedRow>

          <GroupedRow onClick={() => handleShareWhatsApp('attendance')}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon
                name="how_to_reg"
                size={18}
                className="text-[var(--g-whatsapp)] shrink-0"
              />
              <span className="text-sm font-medium text-ink truncate">
                واتساب — الحضور
              </span>
            </div>
            <Icon
              name="chevron_left"
              size={18}
              className="text-ink-muted opacity-65 ltr:rotate-180 shrink-0"
            />
          </GroupedRow>

          <GroupedRow onClick={handleDownloadExcel}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon
                name={exportingExcel ? 'progress_activity' : 'table_view'}
                size={18}
                spin={exportingExcel}
                className="text-success shrink-0"
              />
              <span className="text-sm font-medium text-ink truncate">
                Excel (.xlsx)
              </span>
            </div>
            <Icon
              name="download"
              size={18}
              className="text-ink-muted opacity-65 shrink-0"
            />
          </GroupedRow>

          <GroupedRow onClick={handleDownloadWord}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon
                name={exportingWord ? 'progress_activity' : 'description'}
                size={18}
                spin={exportingWord}
                className="text-primary shrink-0"
              />
              <span className="text-sm font-medium text-ink truncate">
                Word (.doc)
              </span>
            </div>
            <Icon
              name="download"
              size={18}
              className="text-ink-muted opacity-65 shrink-0"
            />
          </GroupedRow>

          <GroupedRow onClick={() => handleCopyText(previewText)}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon
                name={copying ? 'progress_activity' : 'content_copy'}
                size={18}
                spin={copying}
                className="text-ink-muted shrink-0"
              />
              <span className="text-sm font-medium text-ink truncate">
                نسخ النص
              </span>
            </div>
            <Icon
              name="chevron_left"
              size={18}
              className="text-ink-muted opacity-65 ltr:rotate-180 shrink-0"
            />
          </GroupedRow>
        </GroupedList>

        {showPreviewText && (
          <div className="space-y-2.5 pt-2 border-t border-line">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <SegmentedControl
                ariaLabel="نوع المعاينة"
                value={previewMode}
                onChange={setPreviewMode}
                options={[
                  { id: 'summary', label: 'ملخص اليوم' },
                  { id: 'attendance', label: 'الحضور' },
                ]}
              />
              <span className="text-xs font-medium text-ink-muted num-ltr">
                {previewText.length} حرف
              </span>
            </div>

            <pre
              dir="rtl"
              className="max-h-[38dvh] overflow-y-auto p-3.5 rounded-[var(--g-radius-md)] bg-surface-2 border border-line text-xs font-sans whitespace-pre-wrap break-words leading-relaxed text-ink m-0"
            >
              {previewText}
            </pre>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon="content_copy"
                loading={copying}
                onClick={() => handleCopyText(previewText)}
              >
                نسخ
              </Button>
              <Button
                variant="whatsapp"
                size="sm"
                icon="send"
                onClick={() => handleShareWhatsApp(previewMode)}
              >
                واتساب
              </Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
