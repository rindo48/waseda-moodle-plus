// バックグラウンド（Service Worker）。各画面からのメッセージを受けて、Moodle との通信などを行う。
// lib/defaults.js は globalThis.WMP を作るので、bg/* より先に読み込む必要がある。
import "./lib/defaults.js";
import "./lib/syllabus-info.js";
import { clearCaches, getCourses, getSessionKey, getTimeline, setSessionKeyCache, touchSession } from "./bg/moodle.js";
import { loginToMoodle, fetchSessionKeyFromPage, getLoginInfo } from "./bg/login.js";
import { collectSyllabusInformation, getCollectProgress } from "./bg/syllabus.js";
import { applyDarkModeToOpenTabs, syncFeatures } from "./bg/features.js";
import { BADGE_ALARM, handleNotificationClick, updateBadge } from "./bg/badge.js";
import { createLauncherMenus, handleLauncherClick, prepareLaunch } from "./bg/launcher.js";

const { onSettingsChanged, LOGIN_INFO_KEY } = globalThis.WMP;

const handlers = {
    getTimeline: (p) => getTimeline(p ?? {}),
    getCourses: (p) => getCourses(p ?? {}),
    setSessionKey: async ({ sessionKey }) => {
        await setSessionKeyCache(sessionKey);
    },
    touchSession: ({ sessionKey }) => touchSession(sessionKey),
    getSessionKey: () => getSessionKey(),
    /** 自動ログインページ用: ブラウザ側で最後のリダイレクトを行うので、ここでは SAML の手前まで進める */
    autoLogin: () => loginToMoodle({ skipCheck: true, skipFinalRedirect: true }),
    /**
     * 設定画面の「ログインを試す」用
     * @returns {Promise<"ok" | "failed" | "alreadyLoggedIn">}
     */
    testLogin: async () => {
        await getLoginInfo();
        // ログイン済みだと ID・パスワードを使わずに通ってしまうので、試せないことを伝える
        if (await fetchSessionKeyFromPage()) return "alreadyLoggedIn";
        const key = await loginToMoodle({ skipCheck: true });
        if (key) await setSessionKeyCache(key);
        return key ? "ok" : "failed";
    },
    getLoginStatus: async () => {
        const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
        const key = await fetchSessionKeyFromPage().catch(() => null);
        if (key) await setSessionKeyCache(key);
        return { hasLoginInfo: Boolean(info?.userId && info?.password), loggedIn: Boolean(key) };
    },
    collectSyllabus: (p) => {
        // 時間がかかるので待たずに返し、進捗は getCollectProgress で確認してもらう
        collectSyllabusInformation(p ?? {}).catch((e) => console.error(e));
        return getCollectProgress();
    },
    getCollectProgress: () => getCollectProgress(),
    clearCaches: () => clearCaches(),
    updateBadge: (p) => updateBadge(p ?? {}),
    syncFeatures: () => syncFeatures(),
    prepareLaunch: ({ target }) => prepareLaunch(target),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target === "offscreen") return false; // オフスクリーン宛てのメッセージは無視
    const handler = handlers[message?.type];
    if (!handler) return false;
    Promise.resolve()
        .then(() => handler(message.payload))
        .then((result) => sendResponse({ ok: true, result }))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e), name: e?.name }));
    return true;
});

// アラームはブラウザの再起動で消えることがあるので、Service Worker が起動するたびに確認する
chrome.alarms.get(BADGE_ALARM).then((alarm) => {
    if (!alarm) chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
});

chrome.runtime.onInstalled.addListener(async (details) => {
    await createLauncherMenus();
    await syncFeatures();
    updateBadge();
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html?welcome=1") });
    }
});

chrome.runtime.onStartup.addListener(() => {
    syncFeatures();
    updateBadge();
});

chrome.contextMenus.onClicked.addListener(handleLauncherClick);
chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) updateBadge({ force: true });
});

const BADGE_KEYS = [
    "timelineEnabled", "badgeEnabled", "badgeDeadlineRangeDays", "timelineHiddenEventIds",
    "timelineHiddenCourses", "timelineHiddenModuleNames", "timelineForwardDays",
];

onSettingsChanged((_settings, changedKeys) => {
    syncFeatures();
    if (changedKeys.includes("darkMode") || changedKeys.includes("darkModeMethod")) applyDarkModeToOpenTabs();
    if (changedKeys.some((k) => BADGE_KEYS.includes(k))) updateBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LOGIN_INFO_KEY]) syncFeatures();
});
