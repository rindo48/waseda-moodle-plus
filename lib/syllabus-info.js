// シラバスの「授業情報」表（{ 見出し: 値 }）から時間割データを作る。
// シラバスのページ上（コンテンツスクリプト）とバックグラウンドの両方で使う。
(() => {
    const TERM_MAP = {
        春クォーター: "spring_quarter",
        "spring quarter": "spring_quarter",
        夏クォーター: "summer_quarter",
        "summer quarter": "summer_quarter",
        秋クォーター: "fall_quarter",
        "fall quarter": "fall_quarter",
        冬クォーター: "winter_quarter",
        "winter quarter": "winter_quarter",
        春学期: "spring_semester",
        "spring semester": "spring_semester",
        秋学期: "fall_semester",
        "fall semester": "fall_semester",
        通年: "full_year",
        "full year": "full_year",
    };
    const DAY_JA = { 月: "monday", 火: "tuesday", 水: "wednesday", 木: "thursday", 金: "friday", 土: "saturday", 日: "sunday" };
    // 英語表記は大文字・小文字を区別せずに照合する（キーは小文字）
    const DAY_EN = {
        mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", thu: "thursday", thur: "thursday",
        fri: "friday", sat: "saturday", sun: "sunday",
    };

    const zenkakuToHankaku = (s) =>
        s.replace(/[Ａ-Ｚａ-ｚ０-９－（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");

    function pick(info, ...keys) {
        for (const k of keys) if (info[k] !== undefined) return info[k];
        return undefined;
    }

    /** "月２時限" / "Mon.2" / "火３-４" などを {day, from, to} にする */
    function parseDayPeriod(s) {
        s = s.trim();
        if (s.includes(".")) {
            const [d, p] = s.split(".");
            const day = DAY_EN[d.trim().toLowerCase()];
            if (!day) return null;
            const [from, to] = p.split("-").map((x) => parseInt(x));
            if (!from) return null;
            return { day, from, to: to || from };
        }
        const day = DAY_JA[s[0]];
        if (!day) return null;
        const nums = zenkakuToHankaku(s.substring(1)).match(/\d/g);
        if (!nums) return null;
        const from = parseInt(nums[0]);
        const to = parseInt(nums[1] ?? nums[0]);
        return { day, from, to };
    }

    /**
     * @param {Record<string, string>} info - 授業情報表
     * @returns {{ year, term, slots: {year, term, day, from, to, classroom}[], deliveryMethod, title }}
     *   オンデマンドの枠は day が "on_demand" で、from・to を持たない
     */
    function syllabusInfoToTimetable(info) {
        const year = parseInt((pick(info, "開講年度", "Year") ?? "").replace("年度", "")) || undefined;
        const title = pick(info, "科目名", "Course Title");
        const termDayPeriod = (pick(info, "学期曜日時限", "Term/Day/Period") ?? "").split(/  |\s{2,}/);
        const term = TERM_MAP[termDayPeriod[0]?.trim().toLowerCase()];

        const dayPeriodStrings = (termDayPeriod[1] ?? "").includes("／")
            ? termDayPeriod[1].split("／").map((s) => s.substring(s.indexOf(":") + 1))
            : [termDayPeriod[1] ?? ""];

        const classroomRaw = pick(info, "使用教室", "Classroom") ?? "";
        const classrooms = classroomRaw.includes("／")
            ? classroomRaw.split("／").map((s) => s.substring(s.indexOf(":") + 1))
            : [classroomRaw];

        const modality = pick(info, "授業方法区分", "Class Modality Categories") ?? "";
        let deliveryMethod;
        if (/フルオンデマンド|オンデマンド|On-demand/i.test(modality)) deliveryMethod = "on_demand";
        else if (/リアルタイム|Realtime/i.test(modality)) deliveryMethod = "realtime_streaming";
        else if (modality) deliveryMethod = "face_to_face";

        // 曜日・時限のないオンデマンド授業は "無フルOD" のように書かれている
        const isOnDemandText = (s) =>
            /フルOD|オンデマンド|on-?demand/i.test(s) || (/^\s*(無|others?)/i.test(s) && deliveryMethod === "on_demand");

        const slots = [];
        if (year && term) {
            dayPeriodStrings.forEach((s, i) => {
                const dp = parseDayPeriod(s);
                if (!dp) {
                    if (isOnDemandText(s) && !slots.some((x) => x.day === "on_demand")) {
                        slots.push({ year, term, day: "on_demand", classroom: "" });
                    }
                    return;
                }
                const classroom = zenkakuToHankaku(classrooms[i] ?? classrooms[0] ?? "")
                    .trim()
                    .replace(/教室$/, "")
                    .replace(/室$/, "");
                slots.push({ year, term, ...dp, classroom });
            });
            if (slots.length === 0 && deliveryMethod === "on_demand") {
                slots.push({ year, term, day: "on_demand", classroom: "" });
            }
        }

        return { year, term, slots, deliveryMethod, title };
    }

    globalThis.WMP.syllabusInfoToTimetable = syllabusInfoToTimetable;
})();
