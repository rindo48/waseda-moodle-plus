// ツールバーアイコンのバッジ（締切が近い課題の数）と、締切前の通知。

import { getTimeline } from "./moodle.js";

const { getSettings, DAY } = globalThis.WMP;

export const BADGE_ALARM = "badge-update";
const NOTIFIED_KEY = "notifiedEventIds";

/** 「完了していない」とみなすイベント（提出済みの課題などは actionable が false になる） */
const isPending = (e) => e.actionable !== false;

export async function updateBadge({ force = false } = {}) {
    const settings = await getSettings();
    if (!settings.timelineEnabled || !settings.badgeEnabled) {
        await chrome.action.setBadgeText({ text: "" });
        return;
    }
    try {
        if (!(await chrome.action.getBadgeText({}))) {
            await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
            await chrome.action.setBadgeText({ text: "…" });
        }
        const { value: events } = await getTimeline({ force });
        const now = Date.now();
        const until = now + settings.badgeDeadlineRangeDays * DAY;
        const count = events.filter((e) => isPending(e) && e.timesort * 1000 < until).length;

        await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
        await chrome.action.setBadgeBackgroundColor({ color: count > 0 ? "#e5484d" : "#6b7280" });
        await chrome.action.setBadgeTextColor({ color: "#ffffff" });
        await chrome.action.setTitle({
            title: count > 0 ? `Waseda Moodle Plus — ${settings.badgeDeadlineRangeDays}日以内の締切: ${count}件` : "Waseda Moodle Plus",
        });

        await notifyUpcoming(settings, events);
    } catch (e) {
        // 未ログインはよくある状態なので、バッジは消してタイトルで知らせるだけにする
        if (e.name !== "NotLoggedInError") console.warn("failed to update badge", e);
        await chrome.action.setBadgeText({ text: e.name === "NotLoggedInError" ? "" : "!" });
        await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
        await chrome.action.setTitle({ title: `Waseda Moodle Plus — ${e.message ?? e}` });
    }
}

async function notifyUpcoming(settings, events) {
    if (!settings.notificationsEnabled) return;
    const { [NOTIFIED_KEY]: notified = [] } = await chrome.storage.local.get(NOTIFIED_KEY);
    const now = Date.now();
    const threshold = now + settings.notificationHoursBefore * 60 * 60 * 1000;
    const targets = events.filter(
        (e) => isPending(e) && e.timesort * 1000 > now && e.timesort * 1000 <= threshold && !notified.includes(e.id)
    );
    for (const e of targets) {
        const remaining = Math.round((e.timesort * 1000 - now) / (60 * 60 * 1000));
        chrome.notifications.create(`event-${e.id}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
            title: `締切まであと約${remaining}時間`,
            message: `${e.activityname ?? e.name}\n${e.course?.fullname ?? ""}`,
            priority: 1,
        });
    }
    if (targets.length > 0) {
        // 古いIDが溜まりすぎないよう、最新の500件だけ覚えておく
        await chrome.storage.local.set({ [NOTIFIED_KEY]: [...notified, ...targets.map((e) => e.id)].slice(-500) });
    }
}

export async function handleNotificationClick(notificationId) {
    if (!notificationId.startsWith("event-")) return;
    const id = Number(notificationId.slice("event-".length));
    const { value: events } = await getTimeline({ includeHidden: true });
    const event = events.find((e) => e.id === id);
    await chrome.tabs.create({ url: event?.url ?? "https://wsdmoodle.waseda.jp/my/" });
    chrome.notifications.clear(notificationId);
}
