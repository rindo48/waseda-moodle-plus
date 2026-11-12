// バックグラウンド（Service Worker）。各画面からのメッセージを受けて、Moodle との通信などを行う。
// lib/defaults.js は globalThis.WMP を作るので、bg/* より先に読み込む必要がある。
import "./lib/defaults.js";
import "./lib/syllabus-info.js";
import { clearCaches, getCalendarMonth, getCourses, getSessionKey, getTimeline, setSessionKeyCache, touchSession } from "./bg/moodle.js";
import { loginToMoodle, fetchSessionKeyFromPage, getLoginInfo } from "./bg/login.js";
import { collectSyllabusInformation, getCollectProgress } from "./bg/syllabus.js";
import { applyDarkModeToOpenTabs, syncFeatures } from "./bg/features.js";
import { BADGE_ALARM, handleNotificationClick, updateBadge } from "./bg/badge.js";
import { createLauncherMenus, handleLauncherClick, prepareLaunch } from "./bg/launcher.js";
import { UPDATE_ALARM, checkForUpdate } from "./bg/update-check.js";

const { onSettingsChanged, LOGIN_INFO_KEY, MOODLE_ORIGIN } = globalThis.WMP;

/** openLauncher で開いてよいページ（pages/launcher.js が扱えるもの） */
const LAUNCH_TARGETS = ["my_waseda", "grade_inquiry", "course_registration", "portal", "waseda_email"];

const handlers = {
    getTimeline: (p) => getTimeline(p ?? {}),
    getCourses: (p) => getCourses(p ?? {}),
    getCalendarMonth: (p) => getCalendarMonth(p),
    /** Moodle のページ（コンテンツスクリプト）からは設定画面を直接開けないので、代わりに開く */
    openOptions: () => chrome.runtime.openOptionsPage(),
    /** MyWaseda などを、ログインを済ませるページ経由で開く */
    openLauncher: ({ target }) => {
        if (!LAUNCH_TARGETS.includes(target)) throw new Error("開けないページです");
        return chrome.tabs.create({ url: chrome.runtime.getURL(`pages/launcher.html?target=${target}`) });
    },
    setSessionKey: async ({ sessionKey }) => {
        await setSessionKeyCache(sessionKey);
    },
    touchSession: ({ sessionKey }) => touchSession(sessionKey),
    getSessionKey: () => getSessionKey(),
    /**
     * 自動ログインページ用: 通常はブラウザ側で最後のリダイレクトを行うので、ここでは SAML の手前まで進める。
     * complete のときは最後まで済ませる（戻り先のページを直接開くため）
     */
    autoLogin: (p) => loginToMoodle({ skipCheck: true, skipFinalRedirect: !p?.complete }),
    /** 自動ログインページ用: このタブがログイン画面に飛ばされる直前に開こうとしていた URL（無ければ null） */
    takeReturnUrl: async (_payload, sender) => {
        const key = `${RETURN_URL_KEY}:${sender.tab?.id}`;
        const { [key]: saved } = await chrome.storage.session.get(key);
        await chrome.storage.session.remove(key);
        return saved && Date.now() - saved.at < RETURN_URL_TTL_MS ? saved.url : null;
    },
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target === "offscreen") return false; // オフスクリーン宛てのメッセージは無視
    const handler = handlers[message?.type];
    if (!handler) return false;
    Promise.resolve()
        .then(() => handler(message.payload, sender))
        .then((result) => sendResponse({ ok: true, result }))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e), name: e?.name }));
    return true;
});

// ログインが切れたページを開くと Moodle はログイン画面へリダイレクトする（そこを自動ログインページに差し替えている）。
// ログイン後にそのページへ戻れるよう、リダイレクト元の URL をタブごとに覚えておく
const RETURN_URL_KEY = "wmpReturnUrl";
const RETURN_URL_TTL_MS = 5 * 60 * 1000;
chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
        if (details.tabId < 0 || !details.redirectUrl.startsWith(`${MOODLE_ORIGIN}/login/index.php`)) return;
        if (/^\/(login|auth)\//.test(new URL(details.url).pathname)) return;
        chrome.storage.session.set({ [`${RETURN_URL_KEY}:${details.tabId}`]: { url: details.url, at: Date.now() } });
    },
    { urls: [`${MOODLE_ORIGIN}/*`], types: ["main_frame"] }
);

// アラームはブラウザの再起動で消えることがあるので、Service Worker が起動するたびに確認する
chrome.alarms.get(BADGE_ALARM).then((alarm) => {
    if (!alarm) chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
});
// 新しいバージョンの確認は1日1回（最初は起動の1分後）
chrome.alarms.get(UPDATE_ALARM).then((alarm) => {
    if (!alarm) chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
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
    if (alarm.name === UPDATE_ALARM) globalThis.WMP.getSettings().then(checkForUpdate);
});

const BADGE_KEYS = [
    "timelineEnabled", "badgeEnabled", "badgeDeadlineRangeDays", "timelineHiddenEventIds",
    "timelineHiddenCourses", "timelineHiddenModuleNames", "timelineForwardDays", "timelineHideExpectCompletion",
];

onSettingsChanged((_settings, changedKeys) => {
    syncFeatures();
    if (changedKeys.includes("darkMode") || changedKeys.includes("darkModeMethod")) applyDarkModeToOpenTabs();
    if (changedKeys.some((k) => BADGE_KEYS.includes(k))) updateBadge();
    if (changedKeys.includes("updateCheckEnabled")) checkForUpdate(_settings);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LOGIN_INFO_KEY]) syncFeatures();
});
