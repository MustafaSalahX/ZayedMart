import React, { useEffect, useMemo, useState } from 'react';
import ProofUploader from './ProofUploader.jsx';
import VoiceMicButton from './VoiceMicButton.jsx';
import { postActionWithOfflineSupport, apiRequest } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import { formatTimeArabic } from '../lib/exportUtils.js';
import {
  BottomSheet,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  GroupedList,
  Icon,
  SearchFilterBar,
  SectionHeader,
  StatusDot,
} from './ui/index.js';

const QUICK_TRUCK_NOTES = [
  'مطابق للفاتورة',
  'نقص كراتين',
  'تالف مرتجع للمندوب',
  'تم خصم المرتجع السابق',
  'صلاحية قريبة',
];

const CONDITION_META = {
  pending: { label: 'قيد التنزيل', tone: 'warning' },
  complete: { label: 'سليمة', tone: 'success' },
  shortage: { label: 'نواقص', tone: 'warning' },
  return_damaged: { label: 'مرتجع / تالف', tone: 'danger' },
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
  const [busyId, setBusyId] = useState('');
  const [editingTruckLog, setEditingTruckLog] = useState(null);
  const [deletingTruck, setDeletingTruck] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function handleOpenComposer(ev) {
      if (ev?.detail?.action === 'truck_arrive' && canWrite) {
        openArrivalModal({
          isCustom: true,
          name: 'طلبية خاصة',
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
    return suppliers.filter((s) => `${s.name} ${s.category}`.toLowerCase().includes(q));
  }, [suppliers, searchQuery]);

  function openArrivalModal(sup) {
    if (!canWrite) {
      onToast?.('للعرض فقط', 'error');
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
      onToast?.('أدخل اسم المورد', 'error');
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
        res.queuedOffline ? `تم حفظ وصول ${supTitle} محلياً` : `تم تسجيل وصول ${supTitle}`
      );
      setArrivalModalSupplier(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الوصول', 'error');
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
      onToast?.(`تم إنهاء استلام ${completingTruck.supplier_name}`);
      setCompletingTruck(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر إنهاء الاستلام', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearSupplierReturn(supId) {
    if (busyId) return;
    setBusyId(`clear_${supId}`);
    try {
      await apiRequest(`/api/suppliers/${supId}/clear-return`, 'POST');
      onToast?.('تمت تسوية المرتجع');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function handleSaveEditedTruck(e) {
    e?.preventDefault();
    if (!editingTruckLog || busyId) return;
    setBusyId(editingTruckLog.id);
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
      onToast?.('تم حفظ التعديل');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function executeDeleteTruckLog() {
    if (!deletingTruck || busyId) return;
    setBusyId(deletingTruck.id);
    try {
      await apiRequest(`/api/trucks/${deletingTruck.id}`, 'DELETE');
      onToast?.('تم الحذف');
      setDeletingTruck(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  function getElapsedMins(arrivalTime) {
    if (!arrivalTime) return 1;
    const ts = new Date(arrivalTime).getTime();
    if (!Number.isFinite(ts)) return 1;
    return Math.max(1, Math.floor((Date.now() - ts) / 60000));
  }

  const matchedSupplierForCompletion = completingTruck?.supplier_id
    ? suppliers.find((s) => s.id === completingTruck.supplier_id)
    : null;

  return (
    <div className="space-y-6">
      {/* Pending Supplier Returns Hairline Strip */}
      {suppliersWithReturns.length > 0 && (
        <div className="py-2 border-y border-line flex items-center gap-2 text-xs">
          <StatusDot
            tone="warning"
            tintedText
            label={`مرتجع معلق: ${suppliersWithReturns.map((s) => s.name).join('، ')}`}
          />
        </div>
      )}

      {/* 1. Active Unloading Bay */}
      {activeUnloading.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="قيد التنزيل" count={activeUnloading.length} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeUnloading.map((truck) => {
              const elapsed = getElapsedMins(truck.arrival_time);
              const delayed = elapsed > maxUnloadMinutes;
              const safeMax = Math.max(1, Number(maxUnloadMinutes) || 60);
              const pct = Math.min(100, Math.round((elapsed / safeMax) * 100));
              const truckSupplier = suppliers.find(
                (s) => s.id === truck.supplier_id || s.name === truck.supplier_name
              );

              return (
                <Card
                  key={truck.id}
                  alert={delayed}
                  padding="md"
                  className="flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold text-base text-ink truncate">
                        {truck.supplier_name}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {truck.category}
                        {truck.plate_or_driver ? ` · ${truck.plate_or_driver}` : ''}
                        {truck.invoice_number ? ` · #${truck.invoice_number}` : ''}
                      </div>
                    </div>

                    <StatusDot
                      tone={delayed ? 'danger' : 'warning'}
                      tintedText={delayed}
                      label={`${elapsed} د`}
                    />
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full ${
                        delayed ? 'bg-warning-solid' : 'bg-primary-solid'
                      }`}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
                    <span className="text-xs text-ink-muted">
                      <span className="num-ltr">{formatTimeArabic(truck.arrival_time)}</span>
                      {' · '}
                      {truck.recorded_by}
                    </span>

                    <div className="w-full sm:w-auto flex flex-wrap items-center gap-1.5">
                      {canCallPhone && truckSupplier?.phone && (
                        <a
                          href={`tel:${truckSupplier.phone}`}
                          aria-label={`اتصال ${truck.supplier_name}`}
                          className="w-11 h-11 rounded-full bg-surface-2 border border-line text-primary flex items-center justify-center no-underline"
                        >
                          <Icon name="call" size={18} />
                        </a>
                      )}
                      {truck.arrival_proof_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon="image"
                          onClick={() =>
                            onPreviewImage?.(truck.arrival_proof_url, truck.supplier_name)
                          }
                        >
                          صورة
                        </Button>
                      )}
                      {canWrite && (
                        <Button
                          type="button"
                          variant="success"
                          size="sm"
                          onClick={() => openCompleteModal(truck)}
                          className="flex-1 sm:flex-none"
                        >
                          إنهاء الاستلام
                        </Button>
                      )}
                      {canManageRecords && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingTruckLog({ ...truck })}
                            aria-label={`تعديل ${truck.supplier_name}`}
                            className="w-11 h-11 rounded-full text-ink-muted hover:text-primary hover:bg-surface-2 flex items-center justify-center cursor-pointer"
                          >
                            <Icon name="edit" size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTruck(truck)}
                            aria-label={`حذف ${truck.supplier_name}`}
                            className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center cursor-pointer"
                          >
                            <Icon name="delete" size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. Search + Custom Arrival Trigger */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <SearchFilterBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="بحث في الموردين"
          className="flex-1"
        />
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            size="md"
            icon="add"
            onClick={() => openArrivalModal({ isCustom: true })}
            className="w-full sm:w-auto shrink-0"
          >
            عربية خاصة
          </Button>
        )}
      </div>

      {/* Suppliers Grid */}
      {suppliers.length === 0 ? (
        <EmptyState
          compact
          title="لا يوجد موردون"
          actionLabel={canManageSuppliers ? 'إضافة مورد' : undefined}
          onAction={canManageSuppliers ? () => onJumpToRealData?.('staff') : undefined}
        />
      ) : filteredSuppliers.length === 0 ? (
        <EmptyState compact title="لا توجد نتائج" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredSuppliers.map((sup) => (
            <Card
              key={sup.id}
              padding="sm"
              alert={Boolean(sup.has_pending_return)}
              className="flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    style={{ backgroundColor: sup.color || 'var(--g-primary-solid)' }}
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-ink truncate">
                      {sup.name}
                    </div>
                    <div className="text-xs text-ink-muted truncate">{sup.category}</div>
                  </div>
                </div>

                {canWrite && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => openArrivalModal(sup)}
                    className="shrink-0"
                  >
                    وصلت
                  </Button>
                )}
              </div>

              {(sup.phone && canCallPhone) || sup.has_pending_return === 1 ? (
                <div className="pt-2 border-t border-line flex items-center justify-between gap-2 flex-wrap text-xs">
                  {canCallPhone && sup.phone ? (
                    <a
                      href={`tel:${sup.phone}`}
                      className="min-h-[36px] inline-flex items-center gap-1.5 text-primary font-medium no-underline num-ltr"
                    >
                      <Icon name="call" size={14} />
                      <span>{sup.phone}</span>
                    </a>
                  ) : (
                    <span />
                  )}

                  {sup.has_pending_return === 1 && (
                    <div className="flex items-center gap-2">
                      <StatusDot
                        tone="warning"
                        tintedText
                        label={sup.pending_return_note || 'مرتجع'}
                      />
                      {canClearReturn && (
                        <button
                          type="button"
                          disabled={busyId === `clear_${sup.id}`}
                          onClick={() => handleClearSupplierReturn(sup.id)}
                          className="min-h-[36px] px-2 text-xs font-semibold text-primary hover:underline cursor-pointer"
                        >
                          تسوية
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* 3. Completed Deliveries Hairline Log */}
      <section className="space-y-2.5">
        <SectionHeader title="سجل اليوم" count={completedToday.length} />

        {completedToday.length === 0 ? (
          <EmptyState compact title="لا توجد طلبيات اليوم" />
        ) : (
          <GroupedList>
            {completedToday.map((t) => {
              const cond = CONDITION_META[t.delivery_condition] || CONDITION_META.complete;
              return (
                <div
                  key={t.id}
                  className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusDot tone={cond.tone} />
                      <span className="font-semibold text-sm text-ink">
                        {t.supplier_name}
                      </span>
                      <span className="text-xs text-ink-muted">
                        · {cond.label} · {t.category}
                      </span>
                    </div>

                    <div className="text-xs text-ink-muted flex flex-wrap items-center gap-1.5">
                      <span className="num-ltr">
                        {formatTimeArabic(t.arrival_time)} – {formatTimeArabic(t.departure_time)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="num-ltr">{t.duration_minutes} د</span>
                      <span aria-hidden="true">·</span>
                      <span>{t.recorded_by}</span>
                      {t.invoice_number && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="num-ltr">#{t.invoice_number}</span>
                        </>
                      )}
                      {t.notes && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-ink">{t.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-auto flex-wrap shrink-0">
                    {t.arrival_proof_url && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon="image"
                        onClick={() => onPreviewImage?.(t.arrival_proof_url, t.supplier_name)}
                      >
                        الوصول
                      </Button>
                    )}
                    {t.completion_proof_url && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon="receipt_long"
                        onClick={() =>
                          onPreviewImage?.(t.completion_proof_url, t.supplier_name)
                        }
                      >
                        الفاتورة
                      </Button>
                    )}
                    {canManageRecords && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingTruckLog({ ...t })}
                          aria-label={`تعديل ${t.supplier_name}`}
                          className="w-11 h-11 rounded-full text-ink-muted hover:text-primary hover:bg-surface-2 flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="edit" size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingTruck(t)}
                          aria-label={`حذف ${t.supplier_name}`}
                          className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="delete" size={18} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </section>

      {/* 1. Arrival BottomSheet */}
      <BottomSheet
        open={Boolean(arrivalModalSupplier)}
        onClose={() => {
          if (!submitting) setArrivalModalSupplier(null);
        }}
        title={
          arrivalModalSupplier?.isCustom
            ? 'وصول طلبية خاصة'
            : arrivalModalSupplier?.name || 'وصول عربية'
        }
        maxWidth="max-w-lg"
        footer={
          arrivalModalSupplier ? (
            <Button
              type="submit"
              form="truck-arrival-form"
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
            >
              تأكيد الوصول
            </Button>
          ) : null
        }
      >
        {arrivalModalSupplier && (
          <form id="truck-arrival-form" onSubmit={handleSubmitArrival} className="space-y-4">
            {arrivalModalSupplier.has_pending_return === 1 && (
              <div className="py-2 border-y border-line">
                <StatusDot
                  tone="warning"
                  tintedText
                  label={
                    arrivalModalSupplier.pending_return_note || 'مرتجع معلق مع هذا المورد'
                  }
                />
              </div>
            )}

            {arrivalModalSupplier.isCustom && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    المورد
                  </label>
                  <input
                    type="text"
                    required
                    value={customSupplierName}
                    onChange={(e) => setCustomSupplierName(e.target.value)}
                    placeholder="اسم المورد"
                    className="g-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    التصنيف
                  </label>
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
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  السيارة / المندوب
                </label>
                <input
                  type="text"
                  value={plateOrDriver}
                  onChange={(e) => setPlateOrDriver(e.target.value)}
                  placeholder="اختياري"
                  className="g-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  رقم الفاتورة
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="اختياري"
                  className="g-input w-full"
                />
              </div>
            </div>

            <ProofUploader
              value={proofDataUrl}
              onChange={setProofDataUrl}
              label="صورة العربية أو البوليصة"
              compact
            />
          </form>
        )}
      </BottomSheet>

      {/* 2. Complete Unloading BottomSheet */}
      <BottomSheet
        open={Boolean(completingTruck)}
        onClose={() => {
          if (!submitting) setCompletingTruck(null);
        }}
        title={completingTruck?.supplier_name || 'إنهاء الاستلام'}
        maxWidth="max-w-lg"
        footer={
          completingTruck ? (
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant="success"
                size="lg"
                fullWidth
                loading={submitting}
                onClick={() => handleCompleteTruck('complete')}
              >
                استلام سليم
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="warning"
                  size="md"
                  fullWidth
                  loading={submitting}
                  onClick={() => handleCompleteTruck('shortage')}
                >
                  نواقص
                </Button>

                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  fullWidth
                  loading={submitting}
                  onClick={() => handleCompleteTruck('return_damaged')}
                >
                  مرتجع / تالف
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {completingTruck && (
          <div className="space-y-4">
            {matchedSupplierForCompletion?.has_pending_return === 1 && canClearReturn && (
              <label className="min-h-[44px] flex items-center gap-2.5 py-2 border-y border-line text-xs font-medium text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearPrevReturn}
                  onChange={(e) => setClearPrevReturn(e.target.checked)}
                  className="w-4 h-4 accent-[var(--g-success-solid)]"
                />
                <span>تمت تسوية المرتجع السابق</span>
              </label>
            )}

            <ProofUploader
              value={proofDataUrl}
              onChange={setProofDataUrl}
              label="صورة الفاتورة"
              compact
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-muted">ملاحظة</span>
                <VoiceMicButton
                  small
                  onToast={onToast}
                  onTranscript={(txt) =>
                    setTruckNote((prev) => (prev ? `${prev} ${txt}` : txt))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TRUCK_NOTES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setTruckNote(truckNote === chip ? '' : chip)}
                    className={`min-h-[40px] text-xs px-3 py-1 rounded-full border cursor-pointer ${
                      truckNote === chip
                        ? 'bg-primary-solid text-on-primary border-primary font-semibold'
                        : 'bg-surface-2 border-line text-ink font-medium'
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
                placeholder="ملاحظة..."
                className="g-input w-full"
              />
            </div>
          </div>
        )}
      </BottomSheet>

      {/* 3. Edit Truck Log BottomSheet */}
      <BottomSheet
        open={Boolean(editingTruckLog && canManageRecords)}
        onClose={() => {
          if (!busyId) setEditingTruckLog(null);
        }}
        title="تعديل السجل"
        subtitle={editingTruckLog?.supplier_name || ''}
        maxWidth="max-w-md"
        footer={
          editingTruckLog ? (
            <Button
              type="submit"
              form="edit-truck-form"
              variant="primary"
              size="lg"
              fullWidth
              loading={busyId === editingTruckLog.id}
            >
              حفظ
            </Button>
          ) : null
        }
      >
        {editingTruckLog && (
          <form id="edit-truck-form" onSubmit={handleSaveEditedTruck} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                المورد
              </label>
              <input
                type="text"
                required
                value={editingTruckLog.supplier_name || ''}
                onChange={(e) =>
                  setEditingTruckLog((x) => ({ ...x, supplier_name: e.target.value }))
                }
                className="g-input"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الحالة
                </label>
                <select
                  value={editingTruckLog.status}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({ ...x, status: e.target.value }))
                  }
                  className="g-input"
                >
                  <option value="unloading">قيد التنزيل</option>
                  <option value="completed">مستلمة</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  النتيجة
                </label>
                <select
                  value={editingTruckLog.delivery_condition}
                  onChange={(e) =>
                    setEditingTruckLog((x) => ({
                      ...x,
                      delivery_condition: e.target.value,
                    }))
                  }
                  className="g-input"
                >
                  <option value="pending">قيد التنزيل</option>
                  <option value="complete">سليمة</option>
                  <option value="shortage">نواقص</option>
                  <option value="return_damaged">مرتجع / تالف</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  السيارة / المندوب
                </label>
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
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الفاتورة
                </label>
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
              <label className="block text-xs font-medium text-ink-muted mb-1">
                ملاحظات
              </label>
              <input
                type="text"
                value={editingTruckLog.notes || ''}
                onChange={(e) =>
                  setEditingTruckLog((x) => ({ ...x, notes: e.target.value }))
                }
                className="g-input"
              />
            </div>
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(deletingTruck)}
        onClose={() => {
          if (!busyId) setDeletingTruck(null);
        }}
        onConfirm={executeDeleteTruckLog}
        title="حذف السجل"
        description={deletingTruck ? `حذف سجل ${deletingTruck.supplier_name}؟` : ''}
        confirmLabel="حذف"
        tone="danger"
        loading={Boolean(busyId)}
      />
    </div>
  );
}
