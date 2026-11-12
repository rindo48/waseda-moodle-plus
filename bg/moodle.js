// Moodle の内部 Web API（/lib/ajax/service.php）を呼ぶ。

import { fetchSessionKeyFromPage, LoginRequiredError, loginToMoodle } from "./login.js";

const { MOODLE_ORIGIN, getSettings, DAY } = globalThis.WMP;

const SESSION_KEY_CACHE = "sessionKeyCache";
const SESSION_KEY_TTL = 2 * 60 * 60 * 1000;

export class NotLoggedInError extends Error {
    constructor() {
        super(globalThis.WMP.t("Waseda Moodle にログインしていません"));
        this.name = "NotLoggedInError";
    }
}

export async function setSessionKeyCache(sessionKey) {
    await chrome.storage.session.set({
        [SESSION_KEY_CACHE]: { sessionKey, expireAt: Date.now() + SESSION_KEY_TTL },
    });
}

async function clearSessionKeyCache() {
    await chrome.storage.session.remove(SESSION_KEY_CACHE);
}

/** セッションキーを取得する。キャッシュ → Moodle のページ → 自動ログイン の順に試す */
export async function getSessionKey({ allowLogin = true } = {}) {
    const { [SESSION_KEY_CACHE]: cache } = await chrome.storage.session.get(SESSION_KEY_CACHE);
    if (cache && cache.expireAt > Date.now()) return cache.sessionKey;

    let key = await fetchSessionKeyFromPage();
    if (!key && allowLogin) key = await tryAutoLogin();
    if (!key) throw new NotLoggedInError();

    await setSessionKeyCache(key);
    return key;
}

async function tryAutoLogin() {
    const settings = await getSettings();
    if (!settings.autoLoginEnabled) return null;
    try {
        return await loginToMoodle({ skipCheck: true });
    } catch (e) {
        if (e instanceof LoginRequiredError) return null;
        throw e;
    }
}

let lastCall = 0;
/** Moodle に負荷をかけないよう、API 呼び出しの間隔を空ける */
async function rateLimit() {
    const wait = lastCall + 300 - Date.now();
    lastCall = Math.max(Date.now(), lastCall + 300);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Moodle API を呼ぶ。セッション切れなら一度だけ再取得してやり直す。
 *
 * @param {string} methodname
 * @param {object} args
 */
export async function callMoodleAPI(methodname, args, { retried = false } = {}) {
    await rateLimit();
    const sessionKey = await getSessionKey();
    const response = await fetch(
        `${MOODLE_ORIGIN}/lib/ajax/service.php?sesskey=${encodeURIComponent(sessionKey)}&info=${methodname}`,
        {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([{ index: 0, methodname, args }]),
        }
    );
    if (!response.ok) throw new Error(globalThis.WMP.t("Moodle API エラー: {status}", { status: response.status }));
    const json = await response.json();

    if (!Array.isArray(json)) throw new Error(json?.error ?? globalThis.WMP.t("Moodle API から不正な応答がありました"));
    const [result] = json;
    if (result.error) {
        const code = result.exception?.errorcode;
        if ((code === "servicerequireslogin" || code === "invalidsesskey") && !retried) {
            await clearSessionKeyCache();
            return callMoodleAPI(methodname, args, { retried: true });
        }
        if (code === "servicerequireslogin") throw new NotLoggedInError();
        throw new Error(result.exception?.message ?? globalThis.WMP.t("Moodle API エラー"));
    }
    return result.data;
}

/** セッションキーが有効か（セッション延長にも使う） */
export async function touchSession(sessionKey) {
    try {
        const response = await fetch(
            `${MOODLE_ORIGIN}/lib/ajax/service.php?sesskey=${encodeURIComponent(sessionKey)}&info=core_session_touch`,
            {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ index: 0, methodname: "core_session_touch", args: {} }]),
            }
        );
        const json = await response.json();
        return Array.isArray(json) && !json[0]?.error;
    } catch {
        return false;
    }
}

// ===== キャッシュ =====

/** 取得中のもの（同じキーへの同時の呼び出しは、1回の取得を待って結果を分け合う） */
const inFlight = new Map();

function withCache(key, ttlMs, force, fetcher) {
    const running = inFlight.get(key);
    if (running) return running;
    const promise = withCacheOnce(key, ttlMs, force, fetcher).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}

async function withCacheOnce(key, ttlMs, force, fetcher) {
    const { [key]: cache } = await chrome.storage.local.get(key);
    if (!force && cache && Date.now() - cache.timestamp < ttlMs) return { value: cache.value, cached: true, timestamp: cache.timestamp };
    try {
        const value = await fetcher();
        const timestamp = Date.now();
        await chrome.storage.local.set({ [key]: { value, timestamp } });
        return { value, cached: false, timestamp };
    } catch (e) {
        // 取得に失敗しても古いキャッシュがあれば返す
        if (cache) return { value: cache.value, cached: true, timestamp: cache.timestamp, error: String(e.message ?? e) };
        throw e;
    }
}

export async function clearCaches() {
    await chrome.storage.local.remove(["timelineCache", "coursesCache"]);
    await clearSessionKeyCache();
}

// ===== タイムライン（課題など） =====

async function fetchActionEvents(timesortfrom) {
    const LIMIT = 50;
    const events = [];
    for (;;) {
        const data = await callMoodleAPI("core_calendar_get_action_events_by_timesort", {
            aftereventid: events[events.length - 1]?.id ?? 0,
            limitnum: LIMIT,
            limittononsuspendedevents: true,
            timesortfrom,
        });
        events.push(...data.events);
        if (data.events.length < LIMIT) break;
    }
    return events.map(slimEvent);
}

/** 保存容量を抑えるため、使う項目だけ残す */
function slimEvent(e) {
    return {
        id: e.id,
        name: e.name,
        activityname: e.activityname,
        activitystr: e.activitystr,
        modulename: e.modulename,
        eventtype: e.eventtype,
        timesort: e.timesort,
        overdue: e.overdue,
        url: e.url ?? e.viewurl,
        actionUrl: e.action?.url,
        actionName: e.action?.name,
        actionable: e.action?.actionable,
        iconUrl: e.icon?.iconurl,
        course: e.course ? { id: e.course.id, fullname: e.course.fullname } : null,
    };
}

/**
 * 先生が設定した「完了予定日」（Moodle の表示では「〜 要完了」）か。提出期限ではない目安の日。
 * 古いキャッシュには eventtype が無いので、名前の末尾でも判断する（lib/timeline-view.js と同じ判定）
 */
function isExpectCompletion(e) {
    return e.eventtype === "expectcompletionon" || /(要完了|should be completed)\s*$/i.test(e.name ?? "");
}

/**
 * タイムラインを取得する（非表示設定を反映済み）。
 *
 * @param {{ force?: boolean, includeHidden?: boolean }} options
 */
export async function getTimeline({ force = false, includeHidden = false } = {}) {
    const settings = await getSettings();
    const from = Math.floor((Date.now() - settings.timelineBackwardDays * DAY) / 1000);
    const result = await withCache("timelineCache", 10 * 60 * 1000, force, () => fetchActionEvents(from));

    const until = Date.now() + settings.timelineForwardDays * DAY;
    const events = result.value.filter(
        (e) =>
            includeHidden ||
            (e.timesort * 1000 <= until &&
                !settings.timelineHiddenEventIds.includes(e.id) &&
                !settings.timelineHiddenCourses.includes(String(e.course?.id)) &&
                !settings.timelineHiddenModuleNames.includes(e.modulename) &&
                !(settings.timelineHideExpectCompletion && isExpectCompletion(e)))
    );
    return { ...result, value: events };
}

// ===== 受講科目 =====

async function fetchEnrolledCourses() {
    const limit = 100;
    let offset = 0;
    const courses = [];
    for (;;) {
        const data = await callMoodleAPI("core_course_get_enrolled_courses_by_timeline_classification", {
            classification: "allincludinghidden",
            customfieldname: "",
            customfieldvalue: "",
            limit,
            offset,
            sort: "fullname",
        });
        courses.push(...data.courses);
        if (data.courses.length < limit) break;
        offset = data.nextoffset;
    }
    return courses.map((c) => ({
        id: String(c.id),
        wasedaId: c.idnumber,
        name: decodeEntities(c.fullname ?? ""),
        url: c.viewurl,
        image: c.courseimage?.startsWith("data:") ? undefined : c.courseimage,
        year: parseInt(c.coursecategory ?? "") || undefined,
        startdate: c.startdate,
        enddate: c.enddate,
        hidden: c.hidden ?? false,
    }));
}

function decodeEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export async function getCourses({ force = false } = {}) {
    return withCache("coursesCache", 6 * 60 * 60 * 1000, force, fetchEnrolledCourses);
}

// ===== カレンダー（新デザインのカレンダー画面用） =====

/** 月のカレンダーを取得する（Moodle のカレンダー画面が月の移動に使っているのと同じ API） */
export async function getCalendarMonth({ year, month }) {
    const data = await callMoodleAPI("core_calendar_get_calendar_monthly_view", { year, month });
    return {
        periodname: data.periodname,
        daynames: (data.daynames ?? []).map((d) => ({ dayno: d.dayno, shortname: d.shortname })),
        weeks: (data.weeks ?? []).map((w) => ({
            prepadding: (w.prepadding ?? []).length,
            postpadding: (w.postpadding ?? []).length,
            days: (w.days ?? []).map((d) => ({
                mday: d.mday,
                wday: d.wday,
                timestamp: d.timestamp,
                istoday: Boolean(d.istoday),
                isweekend: Boolean(d.isweekend),
                events: (d.events ?? []).map(slimCalendarEvent).sort((a, b) => a.timestart - b.timestart),
            })),
        })),
    };
}

function slimCalendarEvent(e) {
    return {
        id: e.id,
        name: decodeEntities(e.name ?? ""),
        timestart: e.timestart,
        timeduration: e.timeduration ?? 0,
        eventtype: e.normalisedeventtype ?? e.eventtype,
        eventtypetext: e.normalisedeventtypetext ?? "",
        modulename: e.modulename ?? null,
        url: e.url ?? e.viewurl ?? null,
        overdue: Boolean(e.overdue),
        course: e.course ? { id: String(e.course.id), fullname: decodeEntities(e.course.fullname ?? "") } : null,
    };
}
