import React, { useState } from 'react';
import {
  deleteTeamMessage,
  hasPermission,
  sendTeamMessage,
  togglePinTeamMessage,
} from '../lib/api.js';
import { formatTimeArabic } from '../lib/exportUtils.js';

const CHANNELS = [
  { id: 'all', label: 'كل القنوات', icon: 'forum' },
  { id: 'cashier', label: 'قناة الكاشيرية 🛒', icon: 'point_of_sale' },
  { id: 'general', label: 'قناة التيم العام 💬', icon: 'groups' },
  { id: 'security', label: 'الأمن والبوابة 🛡️', icon: 'security' },
];

const QUICK_CASHIER_ALERTS = [
  { text: '💵 محتاج فكة عاجلاً على الكاشير', channel: 'cashier', urgent: true },
  { text: '🛒 زحام شديد عند الكاشير — نحتاج فتح كاشير إضافي', channel: 'cashier', urgent: true },
  { text: '🏷️ استعلام عن سعر أو باركود صنف غير مقروء على الكاشير', channel: 'cashier', urgent: false },
  { text: '🛡️ استدعاء مشرف الصالة / الأمن إلى منطقة الكاشير', channel: 'security', urgent: true },
  { text: '📦 استفسار من الكاشير عن توفر صنف بالمخزن', channel: 'general', urgent: false },
];

export default function TeamChatView({
  teamMessages = [],
  authUser,
  permissions = [],
  onRefresh,
  onToast,
}) {
  const userRole = authUser?.role || 'cashier';
  const defaultSendChannel =
    userRole === 'cashier' ? 'cashier' : userRole === 'security' ? 'security' : 'general';

  const [activeChannel, setActiveChannel] = useState('all');
  const [sendChannel, setSendChannel] = useState(defaultSendChannel);
  const [messageText, setMessageText] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canWrite = hasPermission(permissions, userRole, 'chat:write');
  const canManage =
    userRole === 'owner' ||
    userRole === 'supervisor' ||
    hasPermission(permissions, userRole, 'records:manage');

  const filteredMessages = teamMessages.filter((m) => {
    if (activeChannel === 'all') return true;
    return m.channel === activeChannel;
  });

  const pinnedMessages = filteredMessages.filter((m) => Number(m.is_pinned) === 1);

  async function handleSend(e, quickPreset = null) {
    if (e) e.preventDefault();
    const content = quickPreset ? quickPreset.text : messageText.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    try {
      await sendTeamMessage({
        channel: quickPreset ? quickPreset.channel : sendChannel,
        message: content,
        is_urgent: quickPreset ? quickPreset.urgent : isUrgent,
      });
      if (!quickPreset) {
        setMessageText('');
        setIsUrgent(false);
      }
      onToast?.('تم إرسال الرسالة فوراً للتيم ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر إرسال الرسالة', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePin(id) {
    try {
      await togglePinTeamMessage(id);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تثبيت الرسالة', 'error');
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTeamMessage(id);
      onToast?.('تم حذف الرسالة ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حذف الرسالة', 'error');
    }
  }

  const CHANNEL_BADGE = {
    cashier: { label: 'الكاشيرية 🛒', cls: 'bg-[#FEF3C7] text-[#9A5000]' },
    security: { label: 'الأمن والبوابة 🛡️', cls: 'bg-[#FCE8E6] text-[#B3261E]' },
    general: { label: 'التيم العام 💬', cls: 'bg-[#E8F0FE] text-[#0B57D0]' },
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="g-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] flex items-center justify-center">
              <span className="ms-icon filled text-2xl">forum</span>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold m-0">
                تواصل الكاشيرية والتيم المباشر
              </h2>
              <p className="text-xs text-[var(--g-muted)] m-0">
                تنسيق لحظي بين أعضاء الكاشيرية، مشرفي الصالة، الأمن، والإدارة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setActiveChannel(ch.id)}
                className={`px-3.5 py-2 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  activeChannel === ch.id
                    ? 'bg-[var(--g-primary)] text-white shadow-xs'
                    : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                }`}
              >
                <span className="ms-icon text-sm">{ch.icon}</span>
                <span>{ch.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 1-Tap Quick Alerts for Cashiers & Staff */}
        {canWrite && (
          <div className="pt-2 border-t border-[var(--g-border)]">
            <div className="text-[11px] font-extrabold text-[var(--g-muted)] mb-1.5">
              ⚡ نداءات سريعة بلمسة واحدة للكاشيرية والتيم:
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {QUICK_CASHIER_ALERTS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={submitting}
                  onClick={(e) => handleSend(e, q)}
                  className="px-3 py-1.5 rounded-full bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] border border-[var(--g-border)] text-xs font-bold whitespace-nowrap active:scale-95 transition-all"
                >
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pinned Messages Banner */}
      {pinnedMessages.length > 0 && (
        <div className="g-card p-3.5 border-2 border-[var(--g-yellow-border)] bg-[var(--g-yellow-bg)] space-y-2">
          <div className="text-xs font-extrabold text-[var(--g-yellow)] flex items-center gap-1.5">
            <span className="ms-icon text-base">push_pin</span>
            <span>رسائل وتنبيهات مثبتة للتيم ({pinnedMessages.length})</span>
          </div>
          {pinnedMessages.map((pm) => (
            <div
              key={pm.id}
              className="p-2.5 rounded-xl bg-[var(--g-surface)] flex items-center justify-between gap-2 text-xs"
            >
              <div>
                <span className="font-extrabold text-[var(--g-primary)]">{pm.sender_name}: </span>
                <span className="font-bold">{pm.message}</span>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handlePin(pm.id)}
                  className="text-[11px] text-[var(--g-muted)] hover:text-[var(--g-red)] font-bold shrink-0"
                >
                  إلغاء التثبيت
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Compose Message Form */}
      {canWrite && (
        <form onSubmit={handleSend} className="g-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-extrabold text-[var(--g-muted)]">الإرسال في:</span>
              {[
                { id: 'cashier', label: 'قناة الكاشيرية 🛒' },
                { id: 'general', label: 'قناة التيم العام 💬' },
                { id: 'security', label: 'الأمن والبوابة 🛡️' },
              ].map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setSendChannel(ch.id)}
                  className={`px-3 py-1 rounded-full text-xs font-extrabold transition-all ${
                    sendChannel === ch.id
                      ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsUrgent((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-extrabold flex items-center gap-1 transition-all ${
                isUrgent
                  ? 'bg-[var(--g-red)] text-white'
                  : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
              }`}
            >
              <span className="ms-icon text-sm">campaign</span>
              <span>تنبيه عاجل / طارئ</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="اكتب رسالة لباقي الكاشيرية أو التيم أو المشرف..."
              className="g-input flex-1"
            />
            <button
              type="submit"
              disabled={!messageText.trim() || submitting}
              className="px-5 py-3 rounded-2xl bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 disabled:opacity-50 shrink-0 shadow-xs"
            >
              <span className="ms-icon text-base">send</span>
              <span>إرسال</span>
            </button>
          </div>
        </form>
      )}

      {/* Messages Feed */}
      <div className="g-card p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold m-0">
            سجل رسائل وتنبيهات الكاشيرية والتيم ({filteredMessages.length})
          </h3>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
            لا توجد رسائل مسجلة في هذه القناة بعد. ابدأ بإرسال أول رسالة أو نداء سريع!
          </div>
        ) : (
          <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-0.5">
            {filteredMessages.map((msg) => {
              const chMeta = CHANNEL_BADGE[msg.channel] || CHANNEL_BADGE.general;
              const isMine = msg.sender_id && msg.sender_id === authUser?.id;
              return (
                <div
                  key={msg.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    Number(msg.is_urgent) === 1
                      ? 'bg-[var(--g-red-bg)] border-[var(--g-red-border)]'
                      : 'bg-[var(--g-surface-variant)] border-[var(--g-border)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-[var(--g-text)]">
                        {msg.sender_name}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--g-surface)] text-[10px] font-bold text-[var(--g-muted)]">
                        {msg.sender_role}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${chMeta.cls}`}>
                        {chMeta.label}
                      </span>
                      {Number(msg.is_urgent) === 1 && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--g-red)] text-white text-[10px] font-extrabold">
                          🚨 عاجل
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--g-muted)] num-ltr">
                        {formatTimeArabic(msg.created_at)}
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handlePin(msg.id)}
                          title="تثبيت / إلغاء تثبيت"
                          className={`w-7 h-7 rounded-full flex items-center justify-center ${
                            Number(msg.is_pinned) === 1
                              ? 'bg-[var(--g-yellow)] text-white'
                              : 'bg-[var(--g-surface)] text-[var(--g-muted)]'
                          }`}
                        >
                          <span className="ms-icon text-sm">push_pin</span>
                        </button>
                      )}
                      {(canManage || isMine) && (
                        <button
                          type="button"
                          onClick={() => handleDelete(msg.id)}
                          title="حذف الرسالة"
                          className="w-7 h-7 rounded-full bg-[var(--g-surface)] text-[var(--g-red)] flex items-center justify-center"
                        >
                          <span className="ms-icon text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm font-bold m-0 text-[var(--g-text)] leading-relaxed">
                    {msg.message}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
