// シラバス（www.wsl.waseda.jp/syllabus）を検索して、受講科目の曜日・時限・教室を自動取得する。

import { parseHTML } from "./parse.js";
import { getCourses } from "./moodle.js";

const { getSettings, setSettings, syllabusInfoToTimetable } = globalThis.WMP;

const SYLLABUS_URL = "https://www.wsl.waseda.jp/syllabus/index.php";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function searchForm({ keyword, courseTitle, year, past }) {
    const form = new FormData();
    const fields = [
        ["p_number", "100"],
        ["p_page", ""],
        ["pfrontPage", past ? "past" : "now"],
        ["keyword", keyword ?? ""],
        ["kamoku", courseTitle ?? ""],
        ["kyoin", ""],
        ["p_gakki", ""],
        ["p_youbi", ""],
        ["p_jigen", ""],
        ["p_gengo", ""],
        ["p_jyugyohoho", ""],
        ["p_gakubu", ""],
        ["p_keya", ""],
        ["p_keyb", ""],
        ["p_keyc", ""],
        ["p_searcha", "a"],
        ["p_searchb", "b"],
        ["p_searchc", ""],
        ["nendo", past ? String(year ?? "") : ""],
        ["pYear", ""],
        ["pSchl", ""],
        ["pClsOpnSts", past ? "0" : "123"],
        ["pKyoincd", ""],
        ["pKey", ""],
        ["bunya1_hid", ""],
        ["bunya2_hid", ""],
        ["bunya3_hid", ""],
        ["level_hid", ""],
        ["ControllerParameters", "JAA103SubCon"],
        ["pOcw", ""],
        ["pType", ""],
        ["pLng", "jp"],
    ];
    if (past) fields.push(["p_open", ""]);
    for (const [k, v] of fields) form.append(k, v);
    return form;
}

export async function searchSyllabus(query) {
    const response = await fetch(SYLLABUS_URL, { method: "POST", body: searchForm(query), credentials: "include" });
    return parseHTML("syllabusSearch", await response.text());
}

export async function fetchSyllabusInfo(key) {
    const response = await fetch(`https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${encodeURIComponent(key)}&pLng=jp`);
    return parseHTML("syllabusDetail", await response.text());
}

async function fetchOldSyllabusYears() {
    const response = await fetch("https://www.wsl.waseda.jp/syllabus/JAA102.php");
    return parseHTML("oldSyllabusYears", await response.text());
}

/** 進捗状況（設定画面・ダッシュボードから参照する） */
let progress = { running: false, done: 0, total: 0, message: "", succeeded: [], failed: [] };
export const getCollectProgress = () => progress;

/**
 * 受講科目のシラバスを順に検索し、時間割情報を保存する。
 *
 * @param {{ year?: number, onlyMissing?: boolean }} options
 */
export async function collectSyllabusInformation({ year, onlyMissing = false } = {}) {
    if (progress.running) return progress;
    progress = { running: true, done: 0, total: 0, message: "受講科目を取得しています…", succeeded: [], failed: [] };

    try {
        let { value: courses } = await getCourses({ force: true });
        const settings = await getSettings();
        if (year) courses = courses.filter((c) => c.year === year);
        if (onlyMissing) courses = courses.filter((c) => !(settings.timetable[c.id]?.length > 0));

        progress.total = courses.length;
        let oldYears = [];
        try {
            oldYears = await fetchOldSyllabusYears();
        } catch {
            // 過年度の一覧が取れなくても今年度の検索はできる
        }

        const timetable = {};
        const syllabusKeys = {};
        const deliveryMethods = {};

        for (const course of courses) {
            progress.message = `「${course.name}」のシラバスを検索しています（${progress.done + 1}/${courses.length}）`;
            try {
                const found = await findSyllabusForCourse(course, oldYears);
                if (found) {
                    const parsed = syllabusInfoToTimetable(found.info);
                    syllabusKeys[course.id] = found.key;
                    if (parsed.deliveryMethod) deliveryMethods[course.id] = parsed.deliveryMethod;
                    if (parsed.slots.length > 0) timetable[course.id] = parsed.slots;
                    progress.succeeded.push(course.name);
                } else {
                    progress.failed.push(course.name);
                }
            } catch (e) {
                console.warn("syllabus lookup failed", course, e);
                progress.failed.push(course.name);
            }
            progress.done++;
        }

        const latest = await getSettings();
        await setSettings({
            timetable: { ...latest.timetable, ...timetable },
            courseSyllabusKeys: { ...latest.courseSyllabusKeys, ...syllabusKeys },
            courseDeliveryMethods: { ...latest.courseDeliveryMethods, ...deliveryMethods },
        });
        progress.message = `完了: ${progress.succeeded.length}件取得、${progress.failed.length}件見つかりませんでした`;
    } catch (e) {
        progress.message = `エラー: ${e.message ?? e}`;
        throw e;
    } finally {
        progress.running = false;
    }
    return progress;
}

/** Moodle の科目 ID 番号（16桁）に含まれるコースコードで検索し、科目名が一致するものを探す */
async function findSyllabusForCourse(course, oldYears) {
    const id = course.wasedaId;
    if (!id || id.length !== 16) return null;
    const courseCode = id.substring(4, 14);
    const past = course.year && oldYears.includes(course.year);

    await sleep(500);
    const results = await searchSyllabus({ keyword: courseCode, courseTitle: course.name, year: course.year, past });
    const normalize = (s) => (s ?? "").replace(/\s+/g, "");
    const candidates = results.filter((r) => normalize(r.courseTitle) === normalize(course.name));
    // 名前が一致しなくても、検索結果が1件だけならそれを使う
    for (const candidate of candidates.length > 0 ? candidates : results.length === 1 ? results : []) {
        await sleep(500);
        try {
            const info = await fetchSyllabusInfo(candidate.key);
            return { key: candidate.key, info };
        } catch {
            continue;
        }
    }
    return null;
}
