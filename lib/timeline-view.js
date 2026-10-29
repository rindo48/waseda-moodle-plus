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
    const moduleLabel = (name) => MODULE_LABELS[name] ?? "イベント";

    /** 日付の区切り（設定でずらせる）で見た日付キー */
    function dayKey(timestampMs, offsetHours) {
        const d = new Date(timestampMs - offsetHours * 60 * 60 * 1000);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function dayLabel(key, todayKey) {
        const diff = Math.round((key - todayKey) / WMP.DAY);
        const date = WMP.dateFormat.format(new Date(key));
        if (diff === 0) return `今日 · ${date}`;
        if (diff === 1) return `明日 · ${date}`;
        if (diff === 2) return `明後日 · ${date}`;
        if (diff < 0) return `期限切れ · ${date}`;
        return date;
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

        let list = [...events]
            .filter((e) => !q || `${e.activityname ?? e.name} ${e.course?.fullname ?? ""}`.toLowerCase().includes(q))
            .sort((a, b) => a.timesort - b.timesort);
        if (limit) list = list.slice(0, limit);

        if (list.length === 0) {
            return el(
                "div",
                { class: "wmp-empty" },
                el("div", { class: "wmp-empty-icon" }, "✓"),
                el("div", {}, q ? "一致する項目はありません" : "締切が近い課題はありません")
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
                        key === -1 ? "期限切れ" : dayLabel(key, todayKey),
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
                el("span", { class: "wmp-tl-kind" }, moduleLabel(e.modulename)),
                el("span", { class: "wmp-tl-title" }, e.activityname ?? e.name),
                el("span", { class: "wmp-tl-course" }, courseLabel)
            ),
            el(
                "div",
                { class: "wmp-tl-side" },
                el("span", { class: "wmp-tl-time" }, WMP.timeFormat.format(new Date(deadline))),
                el("span", { class: "wmp-tl-remaining" }, WMP.formatRemaining(remaining)),
                e.actionUrl && e.actionName
                    ? el("a", { class: "wmp-tl-action", href: e.actionUrl, target: "_blank", rel: "noopener" }, e.actionName)
                    : null
            ),
            onHide
                ? el(
                      "button",
                      {
                          class: "wmp-icon-btn wmp-tl-hide",
                          title: "この項目を非表示にする（設定画面で元に戻せます）",
                          "aria-label": "非表示にする",
                          onclick: (ev) => {
                              ev.preventDefault();
                              onHide(e);
                          },
                      },
                      "×"
                  )
                : null
        );
    }

    /** 項目を非表示リストに追加する */
    async function hideEvent(event) {
        const settings = await WMP.getSettings();
        if (settings.timelineHiddenEventIds.includes(event.id)) return;
        await WMP.setSettings({ timelineHiddenEventIds: [...settings.timelineHiddenEventIds, event.id] });
    }

    Object.assign(WMP, { renderTimeline, hideEvent, moduleLabel });
})();
