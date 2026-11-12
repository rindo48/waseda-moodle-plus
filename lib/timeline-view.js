// 課題一覧（タイムライン）の表示部品。ポップアップとダッシュボードで共通。
// lib/defaults.js, lib/util.js の後に読み込むこと。
(() => {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    const MODULE_LABELS = {
        assign: "課題",
        quiz: "小テスト",
        forum: "フォーラム",
        hsuforum: "フォーラム",
        workshop: "ワークショップ",
        lesson: "レッスン",
        choice: "投票",
        feedback: "アンケート",
        questionnaire: "アンケート",
        scorm: "SCORM",
        attendance: "出席",
        lti: "外部ツール",
    };
    const moduleLabel = (name) => WMP.t(MODULE_LABELS[name] ?? "イベント");

    /** 日付の区切り（設定でずらせる）で見た日付キー */
    function dayKey(timestampMs, offsetHours) {
        const d = new Date(timestampMs - offsetHours * 60 * 60 * 1000);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function dayLabel(key, todayKey) {
        const diff = Math.round((key - todayKey) / WMP.DAY);
        const date = WMP.dateFormat.format(new Date(key));
        // 「今日」などと日付は別の要素にして、区切り記号ではなく間隔で分ける
        const relative = { 0: WMP.t("今日"), 1: WMP.t("明日"), 2: WMP.t("明後日") }[diff] ?? (diff < 0 ? WMP.t("期限切れ") : null);
        return relative ? [el("span", { class: "wmp-tl-rel" }, relative), el("span", {}, date)] : date;
    }

    /**
     * Moodle のボタン名（「提出をアップロード・入力する」など）は長いので、一覧では短い名前にする。
     * 元の名前はマウスを重ねると出る（title）。
     */
    function shortActionName(name) {
        const text = String(name ?? "").trim();
        if (/提出|submi/i.test(text)) return WMP.t("提出する");
        if (/受験|attempt|quiz/i.test(text)) return WMP.t("受験する");
        if (/投稿|返信|post|reply/i.test(text)) return WMP.t("投稿する");
        if (/回答|answer|respond|feedback/i.test(text)) return WMP.t("回答する");
        if (/出席|attendance/i.test(text)) return WMP.t("出席する");
        // 英語は1文字が短いので、長さの目安を倍にする
        return [...text].length <= (WMP.getLang() === "en" ? 16 : 8) ? text : WMP.t("開く");
    }

    function urgency(ms) {
        if (ms < 0) return "overdue";
        if (ms < WMP.DAY) return "urgent";
        if (ms < 3 * WMP.DAY) return "soon";
        return "later";
    }

    /**
     * 課題一覧を描画する。
     *
     * @param {object[]} events - getTimeline の結果
     * @param {object} settings - 設定
     * @param {{ onHide?: (event) => void, filter?: string, limit?: number }} options
     */
    function renderTimeline(events, settings, { onHide, filter = "", limit } = {}) {
        const now = Date.now();
        const offset = settings.timelineDateBorderOffsetHours ?? 0;
        const todayKey = dayKey(now, offset);
        const q = filter.trim().toLowerCase();

        let list = visibleEvents(events, settings)
            .filter((e) => !q || `${e.activityname ?? e.name} ${e.course?.fullname ?? ""}`.toLowerCase().includes(q))
            .sort((a, b) => a.timesort - b.timesort);
        if (limit) list = list.slice(0, limit);

        if (list.length === 0) {
            return el(
                "div",
                { class: "wmp-empty" },
                el("div", { class: "wmp-empty-icon" }, WMP.icon("check", { size: 20 })),
                el("div", {}, q ? WMP.t("一致する項目はありません") : WMP.t("締切が近い課題はありません"))
            );
        }

        const groups = new Map();
        for (const e of list) {
            const key = e.timesort * 1000 < now ? -1 : dayKey(e.timesort * 1000, offset);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(e);
        }

        return el(
            "div",
            { class: "wmp-timeline" },
            [...groups.entries()].map(([key, items]) =>
                el(
                    "section",
                    { class: "wmp-tl-group" },
                    el(
                        "h3",
                        { class: `wmp-tl-date${key === -1 ? " is-overdue" : ""}` },
                        key === -1 ? WMP.t("期限切れ") : dayLabel(key, todayKey),
                        el("span", { class: "wmp-tl-count" }, String(items.length))
                    ),
                    items.map((e) => renderItem(e, settings, now, onHide))
                )
            )
        );
    }

    function renderItem(e, settings, now, onHide) {
        const deadline = e.timesort * 1000;
        const remaining = deadline - now;
        const color = e.course ? WMP.courseColor(settings, String(e.course.id)) : "#7d8b99";
        const courseLabel = e.course
            ? settings.courseNameOverrides?.[String(e.course.id)] || e.course.fullname
            : "";
        return el(
            "article",
            { class: `wmp-tl-item is-${urgency(remaining)}`, style: { "--wmp-course-color": color } },
            el(
                "a",
                { class: "wmp-tl-main", href: e.url, target: "_blank", rel: "noopener" },
                el("span", { class: "wmp-tl-kind" }, isExpectCompletion(e) ? WMP.t("{kind}の完了予定日（提出期限ではありません）", { kind: moduleLabel(e.modulename) }) : moduleLabel(e.modulename)),
                el("span", { class: "wmp-tl-title" }, e.activityname ?? e.name),
                el("span", { class: "wmp-tl-course" }, courseLabel)
            ),
            el(
                "div",
                { class: "wmp-tl-side" },
                el("span", { class: "wmp-tl-time" }, WMP.timeFormat.format(new Date(deadline))),
                el("span", { class: "wmp-tl-remaining" }, `${isExpectCompletion(e) ? WMP.t("完了予定日から") : ""}${WMP.formatRemaining(remaining)}`),
                e.actionUrl && e.actionName
                    ? el(
                          "a",
                          { class: "wmp-tl-action", href: e.actionUrl, target: "_blank", rel: "noopener", title: e.actionName },
                          shortActionName(e.actionName)
                      )
                    : null
            ),
            onHide
                ? el(
                      "button",
                      {
                          class: "wmp-icon-btn wmp-tl-hide",
                          title: WMP.t("この項目を非表示にする（設定画面で元に戻せます）"),
                          "aria-label": WMP.t("非表示にする"),
                          onclick: (ev) => {
                              ev.preventDefault();
                              onHide(e);
                          },
                      },
                      WMP.icon("close", { size: 14 })
                  )
                : null
        );
    }

    /**
     * 非表示にした項目・科目・種類を除く。
     * バックグラウンドでも除いているが、画面が持っている一覧は「非表示にする」を押す前に取ったものなので、表示のたびにもう一度除く
     */
    function visibleEvents(events, settings) {
        const ids = settings.timelineHiddenEventIds ?? [];
        const courses = settings.timelineHiddenCourses ?? [];
        const modules = settings.timelineHiddenModuleNames ?? [];
        return events.filter((e) => !ids.includes(e.id) && !courses.includes(String(e.course?.id)) && !modules.includes(e.modulename));
    }

    /**
     * 先生が設定した「完了予定日」（Moodle の表示では「〜 要完了」）か。提出期限とは別の日付なので、区別して表示する。
     * 古いキャッシュには eventtype が無いので、名前の末尾でも判断する
     */
    function isExpectCompletion(e) {
        return e.eventtype === "expectcompletionon" || /(要完了|should be completed)\s*$/i.test(e.name ?? "");
    }

    /** 項目を非表示リストに追加する */
    async function hideEvent(event) {
        const settings = await WMP.getSettings();
        if (settings.timelineHiddenEventIds.includes(event.id)) return;
        await WMP.setSettings({ timelineHiddenEventIds: [...settings.timelineHiddenEventIds, event.id] });
    }

    Object.assign(WMP, { renderTimeline, hideEvent, moduleLabel, visibleEvents, isExpectCompletion });
})();
