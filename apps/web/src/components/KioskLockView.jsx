import React, { useMemo, useState } from 'react';
import { postActionWithOfflineSupport } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';

/**
 * شاشة كشك العمال المبسطة (Kiosk Mode)
 * الميزة #7: تظل دائماً بالوضع النهاري الأبيض الساطع حتى لو كانت غرفة الكاميرات بالوضع الليلي
 * الميزة #4: تدعم بضغطة واحدة كروت الـ QR والرمز السريع بدون لمس القوائم
 */
export default function KioskLockView({
  storeName = 'زايد مارت',
  employees = [],
  onOpenQrModal,
  onRefresh,
  onExitKiosk,
}) {
  const [selectedDept, setSelectedDept] = useState('الكل');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const departments = useMemo(() => {
    const s = new Set(['الكل']);
    employees.forEach((e) => s.add(e.department));
    return Array.from(s);
  }, [employees]);

  const list = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (selectedDept !== 'الكل' && e.department !== selectedDept) return false;
      if (q && !`${e.name} ${e.emp_code || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [employees, selectedDept, searchQuery]);

  async function recordKioskAction(emp, actionType) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await postActionWithOfflineSupport('/api/attendance', {
        employee_id: emp.id,
        action_type: actionType,
        recorded_by: 'كشك العمال',
      });

      const label =
        actionType === 'check_in'
          ? 'حضور'
          : actionType === 'break_start'
          ? 'بداية استراحة'
          : actionType === 'break_end'
          ? 'عودة للعمل'
          : 'انصراف';

      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      speakArabicConfirmation(`شكراً يا ${emp.name}، تم تسجيل ${label}`, true);

      setSelectedEmp(null);
      setSuccessBanner({
        name: emp.name,
        label,
        tone: actionType === 'check_out' ? 'bg-[#B3261E]' : 'bg-[#146C2E]',
      });
      setTimeout(() => setSuccessBanner(null), 2600);
      onRefresh?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#1F1F1F] flex flex-col">
      <div className="google-brand-bar" />

      <div className="p-3 sm:p-6 flex flex-col gap-4 max-w-7xl w-full mx-auto">
        {/* Top Kiosk Header */}
        <div className="bg-white border border-[#DEE3EB] rounded-3xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <img
              src="/Logo.png"
              onError={(e) => {
                if (e.currentTarget.src.endsWith('/Logo.png')) {
                  e.currentTarget.src = '/logo.jpeg';
                }
              }}
              alt={storeName || 'زايد مارت'}
              className="w-12 h-12 rounded-2xl object-cover border border-[#DEE3EB] shrink-0 bg-white"
            />
            <div>
              <h1 className="text-lg sm:text-2xl font-extrabold m-0">
                بوابة حضور موظفي {storeName}
              </h1>
              <p className="text-xs sm:text-sm text-[#5F6368] m-0">
                اضغط على اسمك أو ارفع كرت الـ QR للتسجيل في ثانية واحدة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onOpenQrModal?.('scan')}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shadow-xs"
            >
              <span className="ms-icon filled text-lg">qr_code_scanner</span>
              <span>مسح كرت QR / رمز سريع</span>
            </button>

            <button
              type="button"
              onClick={onExitKiosk}
              className="px-3.5 py-2.5 rounded-full bg-[#EDF2FA] text-[#5F6368] text-xs font-bold flex items-center gap-1"
            >
              <span className="ms-icon text-base">lock_open</span>
              <span>خروج</span>
            </button>
          </div>
        </div>

        {/* Department Big Touch Pills + Optional Quick Name/Code Search */}
        {employees.length > 6 && (
          <div className="bg-white border border-[#DEE3EB] rounded-2xl px-4 py-2.5 flex items-center gap-2">
            <span className="ms-icon text-[#5F6368]">search</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسمك أو اكتب الكود السريع (مثل 101)..."
              className="bg-transparent border-none outline-none w-full text-base font-bold text-[#1F1F1F]"
            />
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {departments.map((dept) => (
            <button
              key={dept}
              type="button"
              onClick={() => setSelectedDept(dept)}
              className={`px-5 py-2.5 rounded-full text-sm sm:text-base font-extrabold whitespace-nowrap border transition-all ${
                selectedDept === dept
                  ? 'bg-[#C2E7FF] text-[#001D35] border-transparent'
                  : 'bg-white border-[#DEE3EB] text-[#1F1F1F]'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        {/* Giant Touch Cards (Responsive 2 cols on mobile, 3-4 on tablet/desktop) */}
        {employees.length === 0 ? (
          <div className="bg-white border border-[#DEE3EB] rounded-3xl p-8 text-center space-y-2 shadow-2xs">
            <span className="ms-icon text-4xl text-[#0B57D0]">group_add</span>
            <h2 className="text-lg font-extrabold m-0">لم تتم إضافة موظفين بعد</h2>
            <p className="text-xs sm:text-sm text-[#5F6368] m-0">
              يرجى الدخول بكلمة مرور الإدارة لإضافة موظفي الماركت الحقيقيين أولاً.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {list.map((emp) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => setSelectedEmp(emp)}
              className="bg-white border border-[#DEE3EB] hover:border-[#0B57D0] active:scale-98 rounded-3xl p-4 sm:p-5 flex flex-col items-center text-center gap-2.5 shadow-2xs transition-all"
            >
              <div
                style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl text-white font-extrabold text-xl sm:text-2xl flex items-center justify-center shadow-xs"
              >
                {emp.name[0]}
              </div>
              <div>
                <div className="font-extrabold text-sm sm:text-lg leading-snug">{emp.name}</div>
                <div className="text-[11px] sm:text-xs text-[#5F6368] mt-0.5">
                  {emp.department} • <span className="num-ltr">#{emp.emp_code}</span>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                  emp.currentStatus === 'present'
                    ? 'bg-[#E6F4EA] text-[#146C2E]'
                    : emp.currentStatus === 'on_break'
                    ? 'bg-[#FEF7E0] text-[#B06000]'
                    : emp.currentStatus === 'checked_out'
                    ? 'bg-[#FCE8E6] text-[#B3261E]'
                    : 'bg-[#EDF2FA] text-[#5F6368]'
                }`}
              >
                {emp.currentStatus === 'present'
                  ? 'حاضر الآن ✓'
                  : emp.currentStatus === 'on_break'
                  ? 'في استراحة ☕'
                  : emp.currentStatus === 'checked_out'
                  ? 'انصرف'
                  : 'اضغط للحضور'}
              </span>
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Giant Kiosk Confirmation Sheet */}
      {selectedEmp && (
        <div onClick={() => setSelectedEmp(null)} className="g-modal-overlay">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white text-[#1F1F1F] w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 text-center space-y-5 animate-pop"
          >
            <div
              style={{ backgroundColor: selectedEmp.avatar_color || '#0B57D0' }}
              className="w-18 h-18 mx-auto rounded-3xl text-white font-extrabold text-3xl flex items-center justify-center"
            >
              {selectedEmp.name[0]}
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold m-0">{selectedEmp.name}</h2>
              <p className="text-sm text-[#5F6368] m-0 mt-1">
                {selectedEmp.department} • كود <span className="num-ltr">#{selectedEmp.emp_code}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {(selectedEmp.currentStatus === 'absent' ||
                selectedEmp.currentStatus === 'checked_out') && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => recordKioskAction(selectedEmp, 'check_in')}
                  className="py-5 rounded-full bg-[#146C2E] text-white text-xl font-extrabold flex items-center justify-center gap-3 shadow-md"
                >
                  <span className="ms-icon filled text-3xl">waving_hand</span>
                  <span>تسجيل حضور 👋</span>
                </button>
              )}

              {selectedEmp.currentStatus === 'present' && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'break_start')}
                    className="py-4 rounded-full bg-[#C25E00] hover:bg-[#9A4A00] text-white text-lg font-extrabold flex items-center justify-center gap-2"
                  >
                    <span className="ms-icon filled text-2xl">free_breakfast</span>
                    <span>استراحة / إذن ☕</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'check_out')}
                    className="py-5 rounded-full bg-[#B3261E] text-white text-xl font-extrabold flex items-center justify-center gap-2"
                  >
                    <span className="ms-icon filled text-3xl">logout</span>
                    <span>تسجيل انصراف 🏠</span>
                  </button>
                </>
              )}

              {selectedEmp.currentStatus === 'on_break' && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'break_end')}
                    className="py-5 rounded-full bg-[#0B57D0] text-white text-xl font-extrabold flex items-center justify-center gap-2"
                  >
                    <span className="ms-icon filled text-3xl">play_arrow</span>
                    <span>عودة للعمل ▶️</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'check_out')}
                    className="py-4 rounded-full bg-[#B3261E] text-white text-lg font-extrabold flex items-center justify-center gap-2"
                  >
                    <span className="ms-icon filled text-2xl">logout</span>
                    <span>تسجيل انصراف 🏠</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setSelectedEmp(null)}
                className="py-3 rounded-full bg-[#EDF2FA] text-sm font-extrabold"
              >
                رجوع
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Daylight Confirmation Overlay */}
      {successBanner && (
        <div
          className={`fixed inset-0 z-50 ${successBanner.tone} text-white flex flex-col items-center justify-center p-6 text-center animate-pop`}
        >
          <span className="ms-icon filled" style={{ fontSize: '5.5rem' }}>
            check_circle
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold mt-4 mb-2">
            تم تسجيل {successBanner.label} بنجاح!
          </h2>
          <p className="text-xl sm:text-2xl opacity-95 font-bold">{successBanner.name}</p>
        </div>
      )}
    </div>
  );
}
