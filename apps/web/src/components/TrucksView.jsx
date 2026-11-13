import React, { useEffect, useMemo, useState } from 'react';
import ProofUploader from './ProofUploader.jsx';
import VoiceMicButton from './VoiceMicButton.jsx';
import { postActionWithOfflineSupport, apiRequest } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import { formatTimeArabic, formatTimeWithSeconds } from '../lib/exportUtils.js';

const QUICK_TRUCK_NOTES = [
  'العدد مطابق للفاتورة بالكامل',
  'يوجد نقص في عدد الكراتين',
  'يوجد عبوات تالفة تم إرجاعها للمندوب',
  'تم خصم المرتجع السابق من الفاتورة',
  'تاريخ صلاحية قريب يحتاج متابعة',
];

const CONDITION_META = {
  pending: {
    label: 'جاري التنزيل',
    icon: 'hourglass_top',
    badge: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  },
  complete: {
    label: 'سليمة وكاملة',
    icon: 'check_circle',
    badge: 'bg-[var(--g-green-bg)] text-[var(--g-green)]',
  },
  shortage: {
    label: 'يوجد نواقص',
    icon: 'warning',
    badge: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  },
  return_damaged: {
    label: 'مرتجع / تالف',
    icon: 'sync_problem',
    badge: 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
  },
};

const CALL_ALLOWED_ROLES = new Set(['owner', 'manager', 'supervisor', 'cctv', 'security']);

export default function TrucksView({
  suppliers = [],
  truckLogs = [],
  maxUnloadMinutes = 60,
  actorName = 'الأمن',
  actorRole = '',
  canWrite = true,
  canClearReturn = false,
  canManageSuppliers = false,
  canManageRecords = false,
  onJumpToRealData,
  voiceConfirmEnabled = true,
  onRefresh,
  onToast,
  onPreviewImage,
}) {
  const canCallPhone = CALL_ALLOWED_ROLES.has(actorRole) || canWrite;
  const [, setTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [arrivalModalSupplier, setArrivalModalSupplier] = useState(null);
  const [customSupplierName, setCustomSupplierName] = useState('');
  const [customCategory, setCustomCategory] = useState('بقالة جافة');
  const [plateOrDriver, setPlateOrDriver] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [truckNote, setTruckNote] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [completingTruck, setCompletingTruck] = useState(null);
  const [clearPrevReturn, setClearPrevReturn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingTruckLog, setEditingTruckLog] = useState(null);

  // Live tick every 15s for Smart Truck Unload Timers (Feature #6)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  // SmartFab hook: open custom truck arrival modal from anywhere on Trucks tab
  useEffect(() => {
    function handleOpenComposer(ev) {
      if (ev?.detail?.action === 'truck_arrive' && canWrite) {
        openArrivalModal({
          isCustom: true,
          name: 'مورد عام / طلبية',
          category: 'بقالة جافة',
        });
      }
    }
    window.addEventListener('zayed:open-composer', handleOpenComposer);
    return () => window.removeEventListener('zayed:open-composer', handleOpenComposer);
  }, [canWrite]);

  const activeUnloading = truckLogs.filter((t) => t.status === 'unloading');
  const completedToday = truckLogs.filter((t) => t.status === 'completed');
  const suppliersWithReturns = suppliers.filter((s) => s.has_pending_return === 1);

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      `${s.name} ${s.category}`.toLowerCase().includes(q)
    );
  }, [suppliers, searchQuery]);

  function openArrivalModal(sup) {
    if (!canWrite) {
      onToast?.('عرض فقط — دورك الحالي لا يملك صلاحية تسجيل عربيات', 'error');
      return;
    }
    if (sup?.has_pending_return === 1) {
      playSuccessChime('alert');
    }
    setArrivalModalSupplier(sup);
    setCustomSupplierName('');
    setCustomCategory('بقالة جافة');
    setPlateOrDriver('');
    setInvoiceNumber('');
    setTruckNote('');
    setProofDataUrl('');
  }

  function openCompleteModal(truck) {
    setCompletingTruck(truck);
    setInvoiceNumber(truck.invoice_number || '');
    setTruckNote('');
    setProofDataUrl('');
    setClearPrevReturn(false);
  }

  async function handleSubmitArrival(e) {
    e?.preventDefault();
    if (submitting) return;
    const isCustom = arrivalModalSupplier?.isCustom;
    if (isCustom && !customSupplierName.trim()) {
      onToast?.('يرجى كتابة اسم المورد أو الشركة', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await postActionWithOfflineSupport(
        '/api/trucks/arrive',
        {
          supplier_id: isCustom ? '' : arrivalModalSupplier.id,
          supplier_name: isCustom ? customSupplierName.trim() : arrivalModalSupplier.name,
          category: isCustom ? customCategory : arrivalModalSupplier.category,
          plate_or_driver: plateOrDriver.trim(),
          invoice_number: invoiceNumber.trim(),
          notes: truckNote.trim(),
          recorded_by: actorName,
        },
        {
          rawDataUrl: proofDataUrl,
          proofField: 'arrival_proof_url',
        }
      );

      const supTitle = isCustom ? customSupplierName.trim() : arrivalModalSupplier.name;
      playSuccessChime('in');
      speakArabicConfirmation(`تم تسجيل وصول عربية ${supTitle}`, voiceConfirmEnabled);
      onToast?.(
        res.queuedOffline
          ? `تم حفظ وصول عربية "${supTitle}" محلياً`
          : `تم تسجيل وصول عربية "${supTitle}" وبدء عداد التنزيل`
      );
      setArrivalModalSupplier(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل وصول العربية', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteTruck(condition) {
    if (!completingTruck || submitting) return;
    setSubmitting(true);
    try {
      let proofUrl = '';
      if (proofDataUrl) {
        const up = await apiRequest('/api/upload', 'POST', {
          dataUrl: proofDataUrl,
          prefix: 'truck_complete',
        });
        proofUrl = up.url;
      }

      await apiRequest(`/api/trucks/${completingTruck.id}/complete`, 'POST', {
        delivery_condition: condition,
        invoice_number: invoiceNumber.trim(),
        notes: truckNote.trim(),
        completion_proof_url: proofUrl,
        clear_previous_return: clearPrevReturn,
      });

      playSuccessChime(condition === 'complete' ? 'in' : 'alert');
      speakArabicConfirmation(
        `تم إنهاء استلام طلبية ${completingTruck.supplier_name}`,
        voiceConfirmEnabled
      );
      onToast?.(`تم إغلاق استلام عربية "${completingTruck.supplier_name}" بنجاح`);
      setCompletingTruck(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر إنهاء الطلبية', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearSupplierReturn(supId, e) {
    e.stopPropagation();
    try {
      await apiRequest(`/api/suppliers/${supId}/clear-return`, 'POST');
      onToast?.('تم مسح تنبيه المرتجع السابق للمورد ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSaveEditedTruck(e) {
    e.preventDefault();
    if (!editingTruckLog) return;
    try {
      await apiRequest(`/api/trucks/${editingTruckLog.id}`, 'PUT', {
        supplier_name: editingTruckLog.supplier_name,
        category: editingTruckLog.category,
        plate_or_driver: editingTruckLog.plate_or_driver || '',
        invoice_number: editingTruckLog.invoice_number || '',
        status: editingTruckLog.status,
        delivery_condition: editingTruckLog.delivery_condition,
        notes: editingTruckLog.notes || '',
      });
      setEditingTruckLog(null);
      onToast?.('تم تعديل سجل العربية بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeleteTruckLog(truck) {
    if (!window.confirm(`حذف سجل عربية "${truck.supplier_name}" نهائياً؟`)) return;
    try {
      await apiRequest(`/api/trucks/${truck.id}`, 'DELETE');
      onToast?.('تم حذف سجل العربية');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  function getElapsedMins(arrivalTime) {
    return Math.max(1, Math.floor((Date.now() - new Date(arrivalTime).getTime()) / 60000));
  }

  const matchedSupplierForCompletion = completingTruck?.supplier_id
    ? suppliers.find((s) => s.id === completingTruck.supplier_id)
    : null;

  return (
    <div className="space-y-5">
      {/* Feature #5: Top Supplier Return Alert Summary */}
      {suppliersWithReturns.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-[var(--g-yellow-bg)] border border-[#F29900]/60 flex items-start gap-2.5">
          <span className="ms-icon filled text-xl text-[var(--g-yellow)] shrink-0 mt-0.5">
            assignment_return
          </span>
          <div className="text-xs sm:text-sm font-bold text-[var(--g-yellow)]">
            تذكير مرتجعات الموردين: يوجد مرتجع سابق مفتوح لدى (
            {suppliersWithReturns.map((s) => s.name).join('، ')}) — سيظهر تنبيه تلقائي فور وصول
            عربيتهم لتسوية المرتجع مع المندوب.
          </div>
        </div>
      )}

      {/* 1. Active Unloading Bay with Smart Timer Orange Highlighting (Feature #6) */}
      {activeUnloading.length > 0 && (
        <section className="g-card p-4 sm:p-5 border-2 border-[var(--g-primary)]/40 bg-[var(--g-primary-container)]/15">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <div className="flex items-center gap-2">
              <span className="ms-icon filled text-[var(--g-primary)] text-2xl">
                local_shipping
              </span>
              <h2 className="text-base sm:text-lg font-extrabold m-0">
                عربيات جاري تنزيلها الآن ({activeUnloading.length})
              </h2>
            </div>
            <span className="text-xs text-[var(--g-muted)]">
              يتلون الكرت بالبرتقالي تلقائياً عند تجاوز {maxUnloadMinutes} دقيقة
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {activeUnloading.map((truck) => {
              const elapsed = getElapsedMins(truck.arrival_time);
              const delayed = elapsed > maxUnloadMinutes;
              const pct = Math.min(100, Math.round((elapsed / maxUnloadMinutes) * 100));
              const truckSupplier = suppliers.find(
                (s) => s.id === truck.supplier_id || s.name === truck.supplier_name
              );

              return (
                <div
                  key={truck.id}
                  className={`g-card p-4 flex flex-col justify-between gap-3 ${
                    delayed ? 'g-smart-timer-orange' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-extrabold text-base sm:text-lg">
                        {truck.supplier_name}
                      </div>
                      <div className="text-xs text-[var(--g-muted)] mt-0.5">
                        {truck.category}
                        {truck.plate_or_driver ? ` • ${truck.plate_or_driver}` : ''}
                        {truck.invoice_number ? ` • فاتورة: ${truck.invoice_number}` : ''}
                      </div>
                      {canCallPhone && truckSupplier?.phone && (
                        <a
                          href={`tel:${truckSupplier.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--g-primary-container)] text-[var(--g-primary)] text-xs font-extrabold no-underline"
                        >
                          <span className="ms-icon filled text-sm">call</span>
                          <span>اتصال بالمورد:</span>
                          <span className="num-ltr">{truckSupplier.phone}</span>
                        </a>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-extrabold num-ltr shrink-0 ${
                        delayed
                          ? 'bg-[#C25E00] text-white'
                          : 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                      }`}
                    >
                      <span className="ms-icon text-sm">timer</span>
                      <span>{elapsed} د</span>
                    </span>
                  </div>

                  {/* Smart Timer Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-[var(--g-border)] overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full transition-all ${
                        delayed ? 'bg-[#F29900]' : 'bg-[var(--g-primary)]'
                      }`}
                    />
                  </div>

                  {delayed && (
                    <div className="text-xs font-extrabold text-[var(--g-orange-text)] flex items-center gap-1">
                      <span className="ms-icon filled text-base">alarm</span>
                      <span>
                        تأخرت العربية في التنزيل أكثر من الحد المسموح ({maxUnloadMinutes} دقيقة)!
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--g-border)]">
                    <span className="text-xs text-[var(--g-muted)]">
                      وصلت:{' '}
                      <strong className="num-ltr text-[var(--g-text)]">
                        {formatTimeArabic(truck.arrival_time)}
                      </strong>{' '}
                      ({truck.recorded_by})
                    </span>

                    <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
                      {truck.arrival_proof_url && (
                        <button
                          type="button"
                          onClick={() =>
                            onPreviewImage?.(
                              truck.arrival_proof_url,
                              `وصول عربية ${truck.supplier_name}`
                            )
                          }
                          className="px-3 py-2 rounded-full bg-[var(--g-surface-variant)] text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <span className="ms-icon text-base">image</span>
                          <span>الصورة</span>
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openCompleteModal(truck)}
                          className="flex-1 sm:flex-none min-h-[46px] px-4 py-2.5 rounded-2xl sm:rounded-full bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shadow-xs active:scale-95"
                        >
                          <span className="ms-icon filled text-lg">task_alt</span>
                          <span>إنهاء الاستلام ✓</span>
                        </button>
                      )}
                      {canManageRecords && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingTruckLog({ ...truck })}
                            className="w-9 h-9 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-center text-[var(--g-primary)]"
                            title="تعديل سجل العربية"
                          >
                            <span className="ms-icon text-base">edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTruckLog(truck)}
                            className="w-9 h-9 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center"
                            title="حذف سجل العربية"
                          >
                            <span className="ms-icon text-base">delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. Search + New Supplier Truck Arrival */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="g-search-bar flex-1 flex items-center gap-2.5 px-4 py-2.5">
          <span className="ms-icon text-[var(--g-muted)]">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن اسم الشركة أو تصنيف البضاعة..."
            className="bg-transparent border-none outline-none w-full text-sm sm:text-base text-[var(--g-text)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[var(--g-muted)] flex items-center"
            >
              <span className="ms-icon text-lg">close</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => openArrivalModal({ isCustom: true })}
          className="px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shadow-xs shrink-0"
        >
          <span className="ms-icon filled text-lg">add_circle</span>
          <span>مورد آخر / طلبية خاصة</span>
        </button>
      </div>

      {/* Supplier Cards */}
      {suppliers.length === 0 ? (
        <div className="g-card p-6 sm:p-8 text-center space-y-3 border-2 border-dashed border-[var(--g-border)]">
          <div className="w-14 h-14 mx-auto rounded-3xl bg-[var(--g-green-bg)] text-[var(--g-green)] flex items-center justify-center">
            <span className="ms-icon filled text-3xl">add_business</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold m-0">
              قائمة الموردين الدائمين جاهزة لإضافة شركات التوريد الحقيقية
            </h3>
            <p className="text-xs sm:text-sm text-[var(--g-muted)] m-0 mt-1 max-w-lg mx-auto">
              يمكنك تسجيل أي عربية الآن من زر "مورد آخر / طلبية خاصة" أعلاه، أو إضافة مورديك الدائمين مرة واحدة لتسجيل وصول عربياتهم بلمسة وتفعيل تنبيه المرتجعات التلقائي.
            </p>
          </div>
          {canManageSuppliers && (
            <button
              type="button"
              onClick={() => onJumpToRealData?.('staff')}
              className="px-6 py-3 rounded-full bg-[#146C2E] text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-xs"
            >
              <span className="ms-icon filled text-lg">local_shipping</span>
              <span>+ إضافة الموردين الحقيقيين الآن</span>
            </button>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredSuppliers.map((sup) => (
          <div
            key={sup.id}
            onClick={() => openArrivalModal(sup)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && openArrivalModal(sup)}
            className={`g-card g-card-interactive p-4 cursor-pointer flex flex-col justify-between gap-3 ${
              sup.has_pending_return ? 'g-smart-timer-orange' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  style={{ backgroundColor: sup.color || '#0B57D0' }}
                  className="w-12 h-12 rounded-2xl text-white flex items-center justify-center shrink-0 shadow-2xs"
                >
                  <span className="ms-icon filled text-2xl">{sup.icon || 'local_shipping'}</span>
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-base truncate">{sup.name}</div>
                  <div className="text-xs text-[var(--g-muted)]">{sup.category}</div>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold shrink-0">
                <span>وصلت</span>
                <span className="ms-icon text-sm">local_shipping</span>
              </span>
            </div>

            {canCallPhone && sup.phone && (
              <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                <a
                  href={`tel:${sup.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-[var(--g-primary-container)]/50 hover:bg-[var(--g-primary-container)] text-[var(--g-primary)] border border-[var(--g-primary)]/30 text-xs font-extrabold flex items-center justify-between gap-2 active:scale-95 transition-all no-underline"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="ms-icon filled text-base">call</span>
                    <span>اتصال بالمورد</span>
                  </span>
                  <span className="num-ltr font-black">{sup.phone}</span>
                </a>
              </div>
            )}

            {sup.has_pending_return === 1 && (
              <div className="p-2.5 rounded-xl bg-[var(--g-surface)]/85 border border-[var(--g-orange-border)] text-[var(--g-orange-text)] text-xs font-bold flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5">
                  <span className="ms-icon filled text-base shrink-0 mt-0.5">warning</span>
                  <span>
                    {sup.pending_return_note || 'تنبيه: يوجد مرتجع سابق مع هذا المورد!'}
                  </span>
                </div>
                {canClearReturn && (
                  <button
                    type="button"
                    onClick={(e) => handleClearSupplierReturn(sup.id, e)}
                    className="underline text-[11px] shrink-0 font-extrabold"
                  >
                    تسوية
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {/* 3. Completed Deliveries Log */}
      <section className="g-card p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3.5">
          <span className="ms-icon filled text-[var(--g-primary)]">inventory</span>
          <h2 className="text-base sm:text-lg font-extrabold m-0">
            سجل الطلبيات والعربيات المستلمة اليوم ({completedToday.length})
          </h2>
        </div>

        {completedToday.length === 0 ? (
          <div className="text-center py-8 text-[var(--g-muted)] text-sm">
            لا توجد طلبيات مكتملة في هذا التاريخ بعد.
          </div>
        ) : (
          <div className="space-y-2.5">
            {completedToday.map((t) => {
              const cond = CONDITION_META[t.delivery_condition] || CONDITION_META.complete;
              return (
                <div
                  key={t.id}
                  className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)]/55 border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm sm:text-base">{t.supplier_name}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold ${cond.badge}`}
                      >
                        <span className="ms-icon text-sm">{cond.icon}</span>
                        <span>{cond.label}</span>
                      </span>
                      <span className="text-xs text-[var(--g-muted)]">({t.category})</span>
                    </div>
                    <div className="text-xs text-[var(--g-muted)] mt-1 flex flex-wrap items-center gap-2">
                      <span>
                        وصول:{' '}
                        <strong className="num-ltr">{formatTimeWithSeconds(t.arrival_time)}</strong>
                      </span>
                      <span>
                        • انصراف:{' '}
                        <strong className="num-ltr">
                          {formatTimeWithSeconds(t.departure_time)}
                        </strong>
                      </span>
                      <span>• {t.duration_minutes} د</span>
                      <span>• {t.recorded_by}</span>
                      {t.invoice_number && <span>• فاتورة: {t.invoice_number}</span>}
                    </div>
                    {t.notes && (
                      <div className="flex items-start gap-1 text-xs mt-1 font-semibold text-[var(--g-text)]">
                        <span className="ms-icon text-sm text-[var(--g-text-muted)] shrink-0">notes</span>
                        <span>{t.notes}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {t.arrival_proof_url && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewImage?.(t.arrival_proof_url, `وصول - ${t.supplier_name}`)
                        }
                        className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1"
                      >
                        <span className="ms-icon text-base text-[var(--g-primary)]">image</span>
                        <span>الوصول</span>
                      </button>
                    )}
                    {t.completion_proof_url && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewImage?.(
                            t.completion_proof_url,
                            `فاتورة/استلام - ${t.supplier_name}`
                          )
                        }
                        className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1"
                      >
                        <span className="ms-icon text-base text-[var(--g-green)]">
                          receipt_long
                        </span>
                        <span>الفاتورة</span>
                      </button>
                    )}
                    {canManageRecords && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingTruckLog({ ...t })}
                          className="w-9 h-9 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-center text-[var(--g-primary)]"
                          title="تعديل سجل الطلبية"
                        >
                          <span className="ms-icon text-base">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTruckLog(t)}
                          className="w-9 h-9 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center"
                          title="حذف سجل الطلبية"
                        >
                          <span className="ms-icon text-base">delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Arrival Bottom Sheet / Modal */}
      {arrivalModalSupplier && (
        <div
          onClick={() => !submitting && setArrivalModalSupplier(null)}
          className="g-modal-overlay"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitArrival}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <div>
                <h3 className="text-lg font-extrabold m-0">
                  {arrivalModalSupplier.isCustom
                    ? 'تسجيل وصول مورد أو طلبية خاصة'
                    : `وصول عربية: ${arrivalModalSupplier.name}`}
                </h3>
                <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
                  سيتم تسجيل وقت الوصول تلقائياً وبدء عداد وقت التنزيل
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArrivalModalSupplier(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            {/* Feature #5: Automatic Supplier Return Warning Popup */}
            {arrivalModalSupplier.has_pending_return === 1 && (
              <div className="p-3.5 rounded-2xl g-smart-timer-orange text-[var(--g-orange-text)] text-xs sm:text-sm font-extrabold flex items-start gap-2">
                <span className="ms-icon filled text-xl shrink-0">warning</span>
                <span>
                  تذكير مرتجع مهم:{' '}
                  {arrivalModalSupplier.pending_return_note ||
                    'هذا المورد مسجل عليه مرتجع من زيارة سابقة — تأكد من تسويته مع المندوب قبل المغادرة!'}
                </span>
              </div>
            )}

            {arrivalModalSupplier.isCustom && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم المورد / الشركة *</label>
                  <input
                    type="text"
                    required
                    value={customSupplierName}
                    onChange={(e) => setCustomSupplierName(e.target.value)}
                    placeholder="مثال: شركة النور للمجمدات"
                    className="g-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">التصنيف</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="g-input w-full"
                  >
                    <option>بقالة جافة</option>
                    <option>ألبان وجبن</option>
                    <option>مشروبات وعصائر</option>
                    <option>شيبسي وسناكس</option>
                    <option>مجمدات ولحوم</option>
                    <option>خضار وفاكهة</option>
                    <option>منظفات وورقيات</option>
                    <option>مخبوزات وحلويات</option>
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[var(--g-muted)] mb-1">
                  رقم السيارة أو المندوب (اختياري)
                </label>
                <input
                  type="text"
                  value={plateOrDriver}
                  onChange={(e) => setPlateOrDriver(e.target.value)}
                  placeholder="مثال: أ ب ج 4521 - مندوب محمد"
                  className="g-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--g-muted)] mb-1">
                  رقم الفاتورة / البوليصة (اختياري)
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="مثال: 90412"
                  className="g-input w-full"
                />
              </div>
            </div>

            <ProofUploader
              value={proofDataUrl}
              onChange={setProofDataUrl}
              label="صورة العربية أو البوليصة (فون / سكرين شوت)"
              compact
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="ms-icon filled text-2xl">local_shipping</span>
              <span>تأكيد وصول العربية وبدء التنزيل</span>
            </button>
          </form>
        </div>
      )}

      {/* Complete Unloading Bottom Sheet / Modal */}
      {completingTruck && (
        <div
          onClick={() => !submitting && setCompletingTruck(null)}
          className="g-modal-overlay"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <div>
                <h3 className="text-lg font-extrabold m-0">
                  إنهاء استلام: {completingTruck.supplier_name}
                </h3>
                <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
                  اختر حالة الاستلام بلمسة واحدة أو سجّل ملاحظتك صوتياً
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompletingTruck(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            {matchedSupplierForCompletion?.has_pending_return === 1 && canClearReturn && (
              <label className="flex items-center gap-2.5 p-3 rounded-2xl g-smart-timer-orange text-[var(--g-orange-text)] text-xs font-extrabold cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearPrevReturn}
                  onChange={(e) => setClearPrevReturn(e.target.checked)}
                  className="w-4 h-4 accent-[#146C2E]"
                />
                <span>تم تسوية/خصم المرتجع السابق مع مندوب هذا المورد اليوم ✓</span>
              </label>
            )}

            <ProofUploader
              value={proofDataUrl}
              onChange={setProofDataUrl}
              label="صورة الفاتورة المختومة أو البضاعة التالفة"
              compact
            />

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-[var(--g-muted)]">
                  ملاحظة الاستلام أو إملاء صوتي (اختياري):
                </span>
                <VoiceMicButton
                  small
                  onToast={onToast}
                  onTranscript={(txt) =>
                    setTruckNote((prev) => (prev ? `${prev} ${txt}` : txt))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_TRUCK_NOTES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setTruckNote(truckNote === chip ? '' : chip)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      truckNote === chip
                        ? 'g-pill-active border-transparent'
                        : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] font-medium'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={truckNote}
                onChange={(e) => setTruckNote(e.target.value)}
                placeholder="تفاصيل إضافية (مثل: نقص 2 كرتونة عصير)..."
                className="g-input w-full"
              />
            </div>

            <div className="grid grid-cols-1 gap-2.5 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleCompleteTruck('complete')}
                className="py-3.5 px-4 rounded-full bg-[#146C2E] hover:bg-[#0F5223] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-xs"
              >
                <span className="ms-icon filled text-2xl">verified</span>
                <span>استلام كامل وسليم — انصراف العربية ✓</span>
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleCompleteTruck('shortage')}
                  className="py-3.5 px-4 rounded-full bg-[#C25E00] hover:bg-[#9A4A00] text-white font-extrabold text-sm flex items-center justify-center gap-1.5"
                >
                  <span className="ms-icon filled">report_problem</span>
                  <span>يوجد نواقص</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleCompleteTruck('return_damaged')}
                  className="py-3.5 px-4 rounded-full bg-[#B3261E] hover:bg-[#8C1D18] text-white font-extrabold text-sm flex items-center justify-center gap-1.5"
                >
                  <span className="ms-icon filled">assignment_return</span>
                  <span>مرتجع / تالف</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Truck Log Modal */}
      {editingTruckLog && canManageRecords && (
        <div onClick={() => setEditingTruckLog(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditedTruck}
            className="g-dialog-sheet max-w-md space-y-4 animate-pop"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base font-extrabold m-0">تعديل سجل عربية المورد</h3>
              <button
                type="button"
                onClick={() => setEditingTruckLog(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">اسم المورد</label>
              <input
                type="text"
                required
                value={editingTruckLog.supplier_name || ''}
                onChange={(e) =>
                  setEditingTruckLog((x) => ({ ...x, supplier_name: e.target.value }))
                }
                className="g-input font-bold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">حالة العربية</label>
                <select
                  value={editingTruckLog.status}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({ ...x, status: e.target.value }))
                  }
                  className="g-input font-bold"
                >
                  <option value="unloading">جاري التنزيل</option>
                  <option value="completed">تم الاستلام</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">نتيجة الفحص</label>
                <select
                  value={editingTruckLog.delivery_condition}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({
                      ...x,
                      delivery_condition: e.target.value,
                    }))
                  }
                  className="g-input font-bold"
                >
                  <option value="pending">قيد التنزيل</option>
                  <option value="complete">سليمة وكاملة ✓</option>
                  <option value="shortage">يوجد نواقص</option>
                  <option value="return_damaged">مرتجع / تالف</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">السيارة / المندوب</label>
                <input
                  type="text"
                  value={editingTruckLog.plate_or_driver || ''}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({ ...x, plate_or_driver: e.target.value }))
                  }
                  className="g-input"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">رقم الفاتورة</label>
                <input
                  type="text"
                  value={editingTruckLog.invoice_number || ''}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({ ...x, invoice_number: e.target.value }))
                  }
                  className="g-input"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">ملاحظات</label>
              <input
                type="text"
                value={editingTruckLog.notes || ''}
                onChange={(e) =>
                  setEditingTruckLog((x) => ({ ...x, notes: e.target.value }))
                }
                className="g-input"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
            >
              حفظ تعديل العربية ✓
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
