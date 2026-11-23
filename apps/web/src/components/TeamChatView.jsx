import React, { useMemo, useRef, useState } from 'react';
import {
  deleteTeamMessage,
  hasPermission,
  sendTeamMessage,
  togglePinTeamMessage,
} from '../lib/api.js';
import { formatTimeArabic } from '../lib/exportUtils.js';
import { ROLE_ARABIC_SHORT } from '../lib/navigation.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import VoiceMicButton from './VoiceMicButton.jsx';
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  Icon,
  RoleAvatar,
  SearchFilterBar,
  StatusDot,
} from './ui/index.js';

const CHANNELS = [
  { id: 'all', label: 'الكل' },
  { id: 'cashier', label: 'الكاشيرية' },
  { id: 'general', label: 'العام' },
  { id: 'security', label: 'الأمن' },
];

const SEND_CHANNELS = [
  { id: 'cashier', label: 'الكاشيرية' },
  { id: 'general', label: 'العام' },
  { id: 'security', label: 'الأمن' },
];

const QUICK_CASHIER_ALERTS = [
  {
    text: 'استدعاء الأمن للكاشير',
    channel: 'security',
    urgent: true,
  },
  {
    text: 'مراجعة عميل عند البوابة',
    channel: 'security',
    urgent: false,
  },
  {
    text: 'محتاج فكة على الكاشير',
    channel: 'cashier',
    urgent: true,
  },
  {
    text: 'زحام كاشير — نحتاج كاشير إضافي',
    channel: 'cashier',
    urgent: true,
  },
  {
    text: 'استعلام سعر أو باركود',
    channel: 'cashier',
    urgent: false,
  },
  {
    text: 'استفسار توفر صنف بالمخزن',
    channel: 'general',
    urgent: false,
  },
];

const CHANNEL_LABEL = {
  cashier: 'الكاشيرية',
  security: 'الأمن',
  general: 'العام',
};

export default function TeamChatView({
  teamMessages = [],
  authUser,
  permissions = [],
  walkie,
  onRefresh,
  onToast,
}) {
  const arch = useThemeArchitecture();
  const isMinimal = arch.id === 'minimal';

  const userRole = authUser?.role || 'cashier';
  const defaultSendChannel =
    userRole === 'cashier' ? 'cashier' : userRole === 'security' ? 'security' : 'general';

  const [activeChannel, setActiveChannel] = useState('all');
  const [sendChannel, setSendChannel] = useState(defaultSendChannel);
  const [chatSearch, setChatSearch] = useState('');
  const [messageText, setMessageText] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [deletingMsg, setDeletingMsg] = useState(null);
  const [pendingQuickAlert, setPendingQuickAlert] = useState(null);

  const messageInputRef = useRef(null);

  const canWrite = hasPermission(permissions, userRole, 'chat:write');
  const canManage =
    userRole === 'owner' ||
    userRole === 'supervisor' ||
    hasPermission(permissions, userRole, 'records:manage');

  const channelFilterChips = useMemo(
    () =>
      CHANNELS.map((ch) => ({
        id: ch.id,
        label: ch.label,
        count:
          ch.id === 'all'
            ? teamMessages.length
            : teamMessages.filter((m) => m.channel === ch.id).length,
      })),
    [teamMessages]
  );

  const filteredMessages = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return teamMessages.filter((m) => {
      if (activeChannel !== 'all' && m.channel !== activeChannel) return false;
      if (
        q &&
        !(m.content || m.message || '').toLowerCase().includes(q) &&
        !(m.sender_name || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [teamMessages, activeChannel, chatSearch]);

  const pinnedMessages = useMemo(
    () => filteredMessages.filter((m) => Number(m.is_pinned) === 1),
    [filteredMessages]
  );

  function handleSelectQuickAlert(preset) {
    if (!canWrite || submitting) return;
    setMessageText(preset.text);
    setSendChannel(preset.channel);
    setIsUrgent(Boolean(preset.urgent));
    if (preset.urgent) {
      setPendingQuickAlert(preset);
    } else {
      messageInputRef.current?.focus();
    }
  }

  async function handleSend(e, quickPreset = null) {
    if (e) e.preventDefault();
    const content = quickPreset ? quickPreset.text : messageText.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    try {
      await sendTeamMessage({
        channel: quickPreset ? quickPreset.channel : sendChannel,
        content,
        message: content,
        is_urgent: quickPreset ? quickPreset.urgent : isUrgent,
      });
      setMessageText('');
      setIsUrgent(false);
      setPendingQuickAlert(null);
      onToast?.('تم الإرسال');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر الإرسال', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePin(id) {
    if (busyId) return;
    setBusyId(`pin_${id}`);
    try {
      await togglePinTeamMessage(id);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر التثبيت', 'error');
    } finally {
      setBusyId('');
    }
  }

  async function executeDelete() {
    if (!deletingMsg || busyId) return;
    setBusyId(`del_${deletingMsg.id}`);
    try {
      await deleteTeamMessage(deletingMsg.id);
      onToast?.('تم الحذف');
      setDeletingMsg(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر الحذف', 'error');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className={arch.surfaces.sectionGapClass}>
      {/* Compact 1-Row Walkie Radio Strip */}
      {walkie?.canUseWalkie && (
        <div className="rounded-[var(--g-radius-card)] bg-[var(--g-radio-bg)] text-[var(--g-radio-text)] border border-[var(--g-radio-border)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon
              name="podcasts"
              size={18}
              filled
              className="text-[var(--g-radio-signal-bright)] shrink-0"
            />
            <span className="num-ltr text-xs font-bold text-[var(--g-radio-signal-bright)] shrink-0">
              {walkie.currentChannelMeta?.code || 'CH-01'}
            </span>
            <span className="text-xs sm:text-sm font-semibold truncate">
              · {walkie.currentChannelMeta?.shortLabel || 'الأمن'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => walkie.toggleLivePower?.()}
              className={`min-h-[44px] sm:min-h-[36px] px-3 rounded-full text-xs font-bold cursor-pointer ${
                walkie.liveOn
                  ? 'bg-[var(--g-radio-emergency)] text-[var(--g-radio-text)]'
                  : 'bg-[var(--g-radio-signal-bright)] text-[var(--g-radio-on-signal)]'
              }`}
            >
              {walkie.liveOn ? 'OFF' : 'ON'}
            </button>
            <button
              type="button"
              onClick={() => walkie.setConsoleOpen?.(true)}
              className="min-h-[44px] sm:min-h-[36px] px-3 rounded-full bg-[var(--g-radio-surface)] text-[var(--g-radio-text)] border border-[var(--g-radio-border)] text-xs font-semibold cursor-pointer"
            >
              القنوات
            </button>
            <button
              type="button"
              onClick={() => walkie.sendAlertPing?.()}
              className="min-h-[44px] sm:min-h-[36px] px-3 rounded-full bg-[var(--g-radio-emergency-bg)] text-[var(--g-radio-emergency-text)] border border-[var(--g-radio-emergency-bright)] text-xs font-semibold cursor-pointer"
            >
              جرس
            </button>
          </div>
        </div>
      )}

      {/* Borderless Header + Channel Tabs */}
      <div className="space-y-2.5">
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            isMinimal ? 'pb-2 border-b border-line' : ''
          }`}
        >
          <h1
            className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0`}
          >
            التيم
          </h1>

          <div className="w-full sm:w-56">
            <SearchFilterBar
              value={chatSearch}
              onChange={setChatSearch}
              placeholder="بحث..."
            />
          </div>
        </div>

        <FilterChipRail
          items={channelFilterChips}
          activeId={activeChannel}
          onSelect={setActiveChannel}
        />
      </div>

      {/* Horizontal Quick-Call Strip */}
      {canWrite && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {QUICK_CASHIER_ALERTS.map((q, idx) => (
            <button
              key={idx}
              type="button"
              disabled={submitting}
              onClick={() => handleSelectQuickAlert(q)}
              className={`min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-full border text-xs font-medium whitespace-nowrap active:scale-95 cursor-pointer shrink-0 ${
                q.urgent
                  ? 'bg-danger-bg border-[var(--g-red-border)] text-danger'
                  : 'bg-surface border-line text-ink hover:border-line-strong'
              }`}
            >
              {q.text}
            </button>
          ))}
        </div>
      )}

      {/* Pinned Messages Strip */}
      {pinnedMessages.length > 0 && (
        <GroupedList label="مثبت" count={pinnedMessages.length}>
          {pinnedMessages.map((pm) => (
            <div
              key={pm.id}
              className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <span className="font-semibold text-ink">{pm.sender_name}: </span>
                <span className="text-ink-muted">{pm.content || pm.message}</span>
              </div>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busyId === `pin_${pm.id}`}
                  onClick={() => handlePin(pm.id)}
                  className="shrink-0"
                >
                  إلغاء
                </Button>
              )}
            </div>
          ))}
        </GroupedList>
      )}

      {/* Compose Message Form */}
      {canWrite && (
        <Card padding="sm">
          <form onSubmit={(e) => handleSend(e)} className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {SEND_CHANNELS.map((ch) => {
                  const active = sendChannel === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setSendChannel(ch.id)}
                      className={`min-h-[40px] sm:min-h-[34px] px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                        active
                          ? 'bg-primary-solid text-on-primary font-semibold'
                          : 'bg-surface-2 text-ink-muted hover:text-ink border border-line'
                      }`}
                    >
                      {ch.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setIsUrgent((v) => !v)}
                className={`min-h-[40px] sm:min-h-[34px] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                  isUrgent
                    ? 'bg-danger-solid text-on-danger font-semibold'
                    : 'bg-surface-2 text-ink-muted hover:text-ink border border-line'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
                <span>عاجل</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={messageInputRef}
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="اكتب رسالة..."
                className="g-input flex-1 min-w-0"
              />
              <VoiceMicButton
                small
                onToast={onToast}
                onTranscript={(spoken) =>
                  setMessageText((prev) => (prev ? `${prev} ${spoken}` : spoken))
                }
              />
              <Button
                type="submit"
                variant={isUrgent ? 'danger' : 'primary'}
                size="md"
                loading={submitting}
                disabled={!messageText.trim() || submitting}
                aria-label="إرسال"
                className="shrink-0"
              >
                {!submitting && <Icon name="send" size={18} />}
                <span className="hidden sm:inline">إرسال</span>
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Messages Hairline Feed */}
      {filteredMessages.length === 0 ? (
        <EmptyState compact title="لا توجد رسائل" />
      ) : (
        <GroupedList>
          {filteredMessages.map((msg) => {
            const chLabel = CHANNEL_LABEL[msg.channel] || CHANNEL_LABEL.general;
            const isMine = msg.sender_id && msg.sender_id === authUser?.id;
            const isPinned = Number(msg.is_pinned) === 1;
            const isMsgUrgent = Number(msg.is_urgent) === 1;
            const arabicRole = ROLE_ARABIC_SHORT[msg.sender_role] || msg.sender_role || '';

            return (
              <div key={msg.id} className="px-3.5 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap gap-y-1.5">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap flex-1">
                    <RoleAvatar
                      size="xs"
                      name={msg.sender_name}
                      role={msg.sender_role}
                    />
                    <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                      {msg.sender_name}
                    </span>
                    <span className="text-xs text-ink-muted truncate">
                      {arabicRole ? `${arabicRole} · ${chLabel}` : chLabel}
                    </span>
                    {isMsgUrgent && (
                      <StatusDot tone="danger" tintedText label="عاجل" />
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-xs text-ink-muted num-ltr px-1">
                      {formatTimeArabic(msg.timestamp || msg.created_at)}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        disabled={busyId === `pin_${msg.id}`}
                        onClick={() => handlePin(msg.id)}
                        aria-label={isPinned ? 'إلغاء التثبيت' : 'تثبيت'}
                        className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer ${
                          isPinned
                            ? 'text-warning'
                            : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                        }`}
                      >
                        <Icon name="push_pin" size={18} filled={isPinned} />
                      </button>
                    )}
                    {(canManage || isMine) && (
                      <button
                        type="button"
                        disabled={busyId === `del_${msg.id}`}
                        onClick={() => setDeletingMsg(msg)}
                        aria-label="حذف"
                        className="w-10 h-10 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center cursor-pointer"
                      >
                        <Icon name="delete" size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-ink m-0 leading-relaxed">
                  {msg.content || msg.message}
                </p>
              </div>
            );
          })}
        </GroupedList>
      )}

      <ConfirmSheet
        open={Boolean(pendingQuickAlert)}
        onClose={() => {
          if (!submitting) {
            setPendingQuickAlert(null);
            messageInputRef.current?.focus();
          }
        }}
        onConfirm={() => {
          if (pendingQuickAlert) {
            handleSend(null, pendingQuickAlert);
          }
        }}
        title="إرسال نداء عاجل"
        description={pendingQuickAlert ? pendingQuickAlert.text : ''}
        confirmLabel="إرسال الآن"
        cancelLabel="تعديل"
        tone="danger"
        loading={submitting}
      />

      <ConfirmSheet
        open={Boolean(deletingMsg)}
        onClose={() => {
          if (!busyId) setDeletingMsg(null);
        }}
        onConfirm={executeDelete}
        title="حذف الرسالة"
        description={deletingMsg ? `حذف رسالة ${deletingMsg.sender_name}؟` : ''}
        confirmLabel="حذف"
        tone="danger"
        loading={Boolean(busyId)}
      />
    </div>
  );
}
