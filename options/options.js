// 設定画面。各項目は下の SECTIONS の定義から組み立てる。

(async () => {
    const WMP = globalThis.WMP;
    const { el } = WMP;

    let settings = await WMP.getSettings();
    WMP.applyUiTheme(settings);
    document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

    const savedLabel = document.getElementById("saved");
    let savedTimer;
    async function save(patch) {
        settings = await WMP.setSettings(patch);
        savedLabel.textContent = "保存しました";
        savedLabel.style.opacity = "1";
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => (savedLabel.style.opacity = "0"), 1500);
        if ("uiTheme" in patch) WMP.applyUiTheme(settings);
        render();
    }

    // ===== 項目の部品 =====

    const toggle = (key, title, desc, { dependsOn } = {}) => ({ type: "toggle", key, title, desc, dependsOn });
    const select = (key, title, desc, options, { dependsOn } = {}) => ({ type: "select", key, title, desc, options, dependsOn });
    const number = (key, title, desc, { min, max, unit, dependsOn } = {}) => ({ type: "number", key, title, desc, min, max, unit, dependsOn });
    const custom = (render) => ({ type: "custom", render });

    function itemShell(item, control) {
        const disabled = item.dependsOn && !settings[item.dependsOn];
        return el(
            "div",
            { class: `op-item${disabled ? " is-disabled" : ""}` },
            el(
                "div",
                { class: "op-item-text" },
                el("div", { class: "op-item-title" }, item.title),
                item.desc ? el("div", { class: "op-item-desc", innerHTML: item.desc }) : null
            ),
            control
        );
    }

    function renderItem(item) {
        switch (item.type) {
            case "toggle":
                return itemShell(
                    item,
                    el(
                        "label",
                        { class: "op-switch" },
                        el("input", {
                            type: "checkbox",
                            checked: Boolean(settings[item.key]),
                            "aria-label": item.title,
                            onchange: (e) => save({ [item.key]: e.target.checked }),
                        }),
                        el("span")
                    )
                );
            case "select":
                return itemShell(
                    item,
                    el(
                        "select",
                        { class: "wmp-select", "aria-label": item.title, onchange: (e) => save({ [item.key]: e.target.value }) },
                        item.options.map(([v, label]) => el("option", { value: v, selected: String(settings[item.key]) === String(v) }, label))
                    )
                );
            case "number":
                return itemShell(
                    item,
                    el(
                        "span",
                        { class: "op-row" },
                        el("input", {
                            class: "wmp-input",
                            type: "number",
                            min: item.min,
                            max: item.max,
                            value: settings[item.key],
                            style: { width: "88px", minWidth: "0", flex: "none" },
                            "aria-label": item.title,
                            onchange: (e) => {
                                const n = Number(e.target.value);
                                if (!Number.isNaN(n)) save({ [item.key]: n });
                            },
                        }),
                        item.unit ? el("span", { class: "wmp-muted" }, item.unit) : null
                    )
                );
            case "custom":
                return item.render();
        }
    }

    // ===== 個別の設定部品 =====

    function loginInfoItem() {
        const box = el("div", { class: "op-item is-block" });
        (async () => {
            const { [WMP.LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(WMP.LOGIN_INFO_KEY);
            const userId = el("input", { class: "wmp-input", placeholder: "例: xxxxx@akane.waseda.jp", value: info?.userId ?? "", autocomplete: "username" });
            const password = el("input", { class: "wmp-input", type: "password", placeholder: "パスワード", value: info?.password ?? "", autocomplete: "current-password" });
            const status = el("span", { class: "wmp-muted" });
            box.replaceChildren(
                el(
                    "div",
                    { class: "op-item-text" },
                    el("div", { class: "op-item-title" }, "ログイン情報"),
                    el("div", { class: "op-item-desc" }, "Waseda メールアドレス（@akane.waseda.jp など）とパスワードです。")
                ),
                el(
                    "div",
                    { class: "op-note" },
                    "パスワードはこのパソコンの Chrome の中（拡張機能のストレージ）に暗号化されずに保存されます。共用のパソコンでは使わないでください。多要素認証（MFA）が必要な場合は自動ログインできません。"
                ),
                el("div", { class: "op-row" }, userId, password),
                el(
                    "div",
                    { class: "op-row" },
                    el(
                        "button",
                        {
                            class: "wmp-btn is-primary",
                            onclick: async () => {
                                if (!userId.value || !password.value) {
                                    status.textContent = "ID とパスワードを入力してください";
                                    return;
                                }
                                await chrome.storage.local.set({ [WMP.LOGIN_INFO_KEY]: { userId: userId.value.trim(), password: password.value } });
                                await save({ autoLoginEnabled: true });
                            },
                        },
                        "保存して有効にする"
                    ),
                    el(
                        "button",
                        {
                            class: "wmp-btn",
                            onclick: async () => {
                                status.textContent = "ログインを試しています…";
                                try {
                                    const result = await WMP.send("testLogin");
                                    status.textContent = {
                                        ok: "ログインに成功しました",
                                        failed: "ログインできませんでした",
                                        alreadyLoggedIn:
                                            "Moodle にはすでにログインしています。ID・パスワードを確かめるには、Moodle からログアウトしてから試してください。",
                                    }[result];
                                } catch (e) {
                                    status.textContent = `失敗: ${e.message}`;
                                }
                            },
                        },
                        "ログインを試す"
                    ),
                    el(
                        "button",
                        {
                            class: "wmp-btn is-danger",
                            onclick: async () => {
                                if (!confirm("保存したログイン情報を削除しますか？")) return;
                                await chrome.storage.local.remove(WMP.LOGIN_INFO_KEY);
                                await save({ autoLoginEnabled: false });
                            },
                        },
                        "削除"
                    ),
                    status
                )
            );
        })();
        return box;
    }

    function syllabusItem() {
        const status = el("span", { class: "wmp-muted" });
        const yearInput = el("input", { class: "wmp-input", type: "number", value: WMP.getSchoolYear(), style: { width: "96px", minWidth: "0", flex: "none" } });
        const run = async (onlyMissing) => {
            if (!onlyMissing && !WMP.confirmSyllabusOverwrite(settings, Number(yearInput.value) || undefined)) return;
            try {
                await WMP.send("collectSyllabus", { year: Number(yearInput.value) || undefined, onlyMissing });
                for (;;) {
                    const p = await WMP.send("getCollectProgress");
                    status.textContent = p.message;
                    if (!p.running) break;
                    await new Promise((r) => setTimeout(r, 1000));
                }
            } catch (e) {
                status.textContent = `エラー: ${e.message}`;
            }
        };
        return el(
            "div",
            { class: "op-item is-block" },
            el(
                "div",
                { class: "op-item-text" },
                el("div", { class: "op-item-title" }, "シラバスから時間割を取得"),
                el("div", { class: "op-item-desc" }, "受講中の科目のシラバスを検索して、曜日・時限・教室を自動で設定します。科目数によっては数分かかります。")
            ),
            el(
                "div",
                { class: "op-row" },
                yearInput,
                el("span", { class: "wmp-muted" }, "年度"),
                el("button", { class: "wmp-btn is-primary", onclick: () => run(false) }, "すべて取得"),
                el("button", { class: "wmp-btn", onclick: () => run(true) }, "未設定の科目だけ"),
                el(
                    "button",
                    {
                        class: "wmp-btn is-danger",
                        onclick: () => confirm("時間割の情報（曜日・時限・教室）をすべて消しますか？") && save({ timetable: {} }),
                    },
                    "時間割をリセット"
                )
            ),
            status
        );
    }

    function hiddenItems() {
        const box = el("div", { class: "op-item is-block" });
        const removeFrom = (key, value) => save({ [key]: settings[key].filter((x) => x !== value) });
        const tags = (key, labelOf) =>
            settings[key].length === 0
                ? el("span", { class: "wmp-muted" }, "なし")
                : el(
                      "div",
                      { class: "op-list" },
                      settings[key].map((v) =>
                          el("span", { class: "op-tag" }, labelOf(v), el("button", { class: "wmp-icon-btn", title: "再表示", "aria-label": "再表示", onclick: () => removeFrom(key, v) }, WMP.icon("close", { size: 14 })))
                      )
                  );

        (async () => {
            let courses = [];
            try {
                courses = (await WMP.send("getCourses")).value;
            } catch {
                // ログインしていなくても ID で表示する
            }
            const courseLabel = (id) => courses.find((c) => c.id === id)?.name ?? `科目 ${id}`;
            const courseSelect = el(
                "select",
                { class: "wmp-select", style: { maxWidth: "320px" } },
                el("option", { value: "" }, "科目を選んで非表示にする…"),
                courses.filter((c) => !settings.timelineHiddenCourses.includes(c.id)).map((c) => el("option", { value: c.id }, c.name))
            );
            courseSelect.addEventListener("change", () => {
                if (courseSelect.value) save({ timelineHiddenCourses: [...settings.timelineHiddenCourses, courseSelect.value] });
            });

            box.replaceChildren(
                el(
                    "div",
                    { class: "op-item-text" },
                    el("div", { class: "op-item-title" }, "非表示にした項目"),
                    el("div", { class: "op-item-desc" }, "課題一覧の「非表示にする」ボタンで隠した項目や、表示しない科目・種類です。")
                ),
                el(
                    "div",
                    { class: "op-row" },
                    el("span", {}, `非表示にした課題など: ${settings.timelineHiddenEventIds.length}件`),
                    settings.timelineHiddenEventIds.length > 0
                        ? el("button", { class: "wmp-btn is-small", onclick: () => save({ timelineHiddenEventIds: [] }) }, "すべて再表示")
                        : null
                ),
                el("div", { class: "op-item-title" }, "表示しない科目"),
                tags("timelineHiddenCourses", courseLabel),
                courses.length > 0 ? courseSelect : null,
                el("div", { class: "op-item-title" }, "表示しない種類"),
                el(
                    "div",
                    { class: "op-list" },
                    ["assign", "quiz", "forum", "attendance", "feedback", "questionnaire", "workshop", "lesson", "choice"].map((m) =>
                        el(
                            "label",
                            { class: "wmp-check" },
                            el("input", {
                                type: "checkbox",
                                checked: settings.timelineHiddenModuleNames.includes(m),
                                onchange: (e) =>
                                    save({
                                        timelineHiddenModuleNames: e.target.checked
                                            ? [...settings.timelineHiddenModuleNames, m]
                                            : settings.timelineHiddenModuleNames.filter((x) => x !== m),
                                    }),
                            }),
                            `${WMP.moduleLabel?.(m) ?? m}（${m}）`
                        )
                    )
                )
            );
        })();
        return box;
    }

    function filenameTemplateItem() {
        return el(
            "div",
            { class: `op-item is-block${settings.assignmentFilenameEnabled ? "" : " is-disabled"}` },
            el(
                "div",
                { class: "op-item-text" },
                el("div", { class: "op-item-title" }, "ファイル名の形式"),
                el("div", {
                    class: "op-item-desc",
                    innerHTML:
                        "<code>{filename}</code> 元のファイル名、<code>{extension}</code> 拡張子（.pdf など）、<code>{course}</code> 科目名、<code>{assignment}</code> 課題名。科目ごとの形式はダッシュボードの時間割で科目の設定ボタンから設定できます。",
                })
            ),
            el("input", {
                class: "wmp-input",
                value: settings.assignmentFilenameTemplate,
                onchange: (e) => save({ assignmentFilenameTemplate: e.target.value }),
            })
        );
    }

    function backupItem() {
        const fileInput = el("input", { type: "file", accept: "application/json", hidden: true });
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                const restored = data.settings ?? data;
                const known = Object.fromEntries(Object.entries(restored).filter(([k]) => k in WMP.DEFAULT_SETTINGS));
                if (!confirm(`${Object.keys(known).length}項目の設定を読み込みます。現在の設定は上書きされます。よろしいですか？`)) return;
                await save(known);
            } catch (e) {
                alert(`読み込めませんでした: ${e.message}`);
            }
        });
        return el(
            "div",
            { class: "op-item" },
            el(
                "div",
                { class: "op-item-text" },
                el("div", { class: "op-item-title" }, "バックアップ"),
                el("div", { class: "op-item-desc" }, "時間割・色・メモを含む設定を JSON ファイルに書き出します。ログイン情報は含まれません。")
            ),
            el(
                "div",
                { class: "op-row" },
                el(
                    "button",
                    {
                        class: "wmp-btn",
                        onclick: async () => {
                            const blob = new Blob([JSON.stringify({ app: "waseda-moodle-plus", version: 1, settings: await WMP.getSettings() }, null, 2)], {
                                type: "application/json",
                            });
                            const a = el("a", { href: URL.createObjectURL(blob), download: `waseda-moodle-plus-${new Date().toISOString().slice(0, 10)}.json` });
                            a.click();
                            URL.revokeObjectURL(a.href);
                        },
                    },
                    "書き出す"
                ),
                el("button", { class: "wmp-btn", onclick: () => fileInput.click() }, "読み込む"),
                fileInput
            )
        );
    }

    function maintenanceItem() {
        const status = el("span", { class: "wmp-muted" });
        return el(
            "div",
            { class: "op-item" },
            el(
                "div",
                { class: "op-item-text" },
                el("div", { class: "op-item-title" }, "キャッシュを削除"),
                el("div", { class: "op-item-desc" }, "新しく登録した科目や課題が表示されないときに使います。"),
                status
            ),
            el(
                "button",
                {
                    class: "wmp-btn",
                    onclick: async () => {
                        await WMP.send("clearCaches");
                        status.textContent = "削除しました";
                    },
                },
                "削除"
            )
        );
    }

    // ===== セクション定義 =====

    const SECTIONS = [
        {
            id: "appearance",
            title: "外観・ダークモード",
            items: [
                select(
                    "design",
                    "デザイン",
                    "「新デザイン」では、上のタブを左の縦メニューに移し、今学期の科目と締切をどのページからも開けるようにします。ダッシュボード・マイコース・カレンダー・ホーム・コースページの表示も作り替えます（各ページの「Moodle の表示」で元に戻せます）。Ctrl+K で科目・締切・ページをまとめて探せます。切り替えは次にページを開いたときから反映されます。",
                    [
                        ["classic", "旧デザイン（今までの見た目）"],
                        ["new", "新デザイン"],
                    ]
                ),
                toggle(
                    "designToggleInHeader",
                    "ヘッダーにデザインの切り替えボタンを表示",
                    "Moodle の上部ヘッダーに、旧デザインと新デザインを切り替えるボタンを表示します。押すとページを読み込み直します。"
                ),
                select("darkMode", "Moodle のダークモード", "Moodle のページを暗い配色で表示します。", [
                    ["off", "オフ"],
                    ["on", "常にオン"],
                    ["auto", "システムの設定に合わせる"],
                ]),
                select(
                    "darkModeMethod",
                    "ダークモードの方式",
                    "「専用テーマ」は自然な配色ですが、一部のページで色が残ることがあります。「色の反転」はどのページでも暗くなりますが、色合いが変わります。",
                    [
                        ["theme", "専用テーマ（おすすめ）"],
                        ["invert", "色の反転"],
                    ]
                ),
                select("uiTheme", "この拡張機能の画面のテーマ", "ポップアップと設定画面の配色です。", [
                    ["auto", "システムの設定に合わせる"],
                    ["light", "ライト"],
                    ["dark", "ダーク"],
                ]),
                toggle(
                    "darkModeToggleInHeader",
                    "ヘッダーに切り替えボタンを表示",
                    "Moodle の上部ヘッダー（通知アイコンの左）に、ダークモードをオン・オフするボタンを表示します。"
                ),
                toggle("modernLook", "見た目を整える（旧デザイン）", "角丸・余白・フォントなど、Moodle の見た目を少しだけ読みやすくします。新デザインではこの内容が含まれているので、この設定は使われません。"),
            ],
        },
        {
            id: "auto-login",
            title: "自動ログイン",
            items: [
                toggle("autoLoginEnabled", "自動ログイン", "ログインが必要なページを開いたとき、保存した ID・パスワードで自動的にログインします。MyWaseda・成績照会などもアイコンの右クリックメニューからログイン済みで開けます。"),
                custom(loginInfoItem),
            ],
        },
        {
            id: "timetable",
            title: "時間割",
            items: [
                toggle("courseOverviewEnabled", "ダッシュボードに時間割を表示", "Moodle のダッシュボード（マイページ）に曜日×時限の時間割を表示します。"),
                custom(syllabusItem),
                toggle("showSaturday", "土曜日を表示", "", { dependsOn: "courseOverviewEnabled" }),
                toggle("showSunday", "日曜日を表示", "", { dependsOn: "courseOverviewEnabled" }),
                select(
                    "timetableMaxPeriod",
                    "表示する時限",
                    "これより後の時限に科目がある場合は、その時限まで自動で表示します。",
                    [
                        ["5", "5限まで"],
                        ["6", "6限まで"],
                        ["7", "7限まで"],
                    ],
                    { dependsOn: "courseOverviewEnabled" }
                ),
                toggle("showPeriodTimes", "時限の時刻を表示", "", { dependsOn: "courseOverviewEnabled" }),
                toggle("showClassroom", "教室を表示", "", { dependsOn: "courseOverviewEnabled" }),
                toggle("showAssignmentCountOnTimetable", "科目ごとの課題数を表示", "締切前の課題がある科目に赤い数字を表示します。", { dependsOn: "courseOverviewEnabled" }),
            ],
        },
        {
            id: "timeline",
            title: "課題一覧",
            items: [
                toggle("timelineEnabled", "課題一覧", "ツールバーのアイコンをクリックすると、締切が近い課題・小テストなどの一覧を表示します。"),
                toggle("timelineShowInDashboard", "ダッシュボードにも表示", "", { dependsOn: "timelineEnabled" }),
                toggle("badgeEnabled", "アイコンに件数を表示", "締切が近い課題の数をアイコンに表示します。", { dependsOn: "timelineEnabled" }),
                number("badgeDeadlineRangeDays", "件数に含める範囲", "", { min: 1, max: 60, unit: "日以内の締切", dependsOn: "badgeEnabled" }),
                toggle("notificationsEnabled", "締切前に通知", "締切が近づくとデスクトップ通知でお知らせします（約30分ごとに確認）。", { dependsOn: "timelineEnabled" }),
                number("notificationHoursBefore", "通知のタイミング", "", { min: 1, max: 168, unit: "時間前", dependsOn: "notificationsEnabled" }),
                number("timelineBackwardDays", "過去の期限切れを表示する期間", "", { min: 0, max: 365, unit: "日前まで", dependsOn: "timelineEnabled" }),
                number("timelineForwardDays", "先の予定を表示する期間", "", { min: 1, max: 730, unit: "日後まで", dependsOn: "timelineEnabled" }),
                number(
                    "timelineDateBorderOffsetHours",
                    "日付の区切りをずらす",
                    "例えば 2 にすると、深夜 1:59 締切の課題を前日の欄に表示します。",
                    { min: 0, max: 12, unit: "時間", dependsOn: "timelineEnabled" }
                ),
                custom(hiddenItems),
            ],
        },
        {
            id: "quiz",
            title: "小テスト",
            items: [
                toggle("quizRemainingTimeEnabled", "残り時間を見やすくする", "残り時間を画面の右下に大きく固定表示します。"),
                toggle("remindUnansweredEnabled", "未解答の問題を確認する", "解答していない問題があるまま次のページへ進もうとしたときに確認します。"),
                toggle("remindUnansweredOnlySequential", "前に戻れない小テストのときだけ確認", "", { dependsOn: "remindUnansweredEnabled" }),
            ],
        },
        {
            id: "assignment",
            title: "課題の提出",
            items: [
                toggle("checkSessionBeforeSubmit", "提出前にセッションを確認", "小テスト・課題・フォーラムの送信前に、ログインが切れていないか確認します。切れていたら送信を止めて知らせます。"),
                toggle("autoSessionExtension", "セッションを自動で延長", "Moodle のタブを開いている間、ログインが切れないようにします。"),
                toggle("checkNotesOnSubmitting", "提出時の注意事項に自動でチェック", "課題提出画面で毎回チェックが必要な確認欄に、自動でチェックを入れます。"),
                toggle("wordCounterEnabled", "文字数カウンター", "テキスト入力欄の下に文字数（英文なら単語数）を表示します。クリックで切り替えられます。"),
                toggle("assignmentFilenameEnabled", "提出ファイルの名前を自動で変更", "課題提出ページでファイルをアップロードするとき、ファイル名を指定した形式に変えます。"),
                custom(filenameTemplateItem),
            ],
        },
        {
            id: "style",
            title: "スタイルの修正",
            items: [
                toggle("reduceCourseContentPadding", "科目ページの余白を減らす", "コースページの活動一覧を詰めて表示します。"),
                toggle("removeFloatingActionButtons", "右下の丸いボタンを消す", ""),
                toggle("removeNotificationBadge", "通知の未読数バッジを消す", "マウスを重ねると表示されます。"),
            ],
        },
        {
            id: "others",
            title: "その他",
            items: [
                toggle("viewInBrowser", "ファイルをブラウザで開く", "PDF などブラウザで表示できるファイルを、ダウンロードせずに直接開きます。"),
                toggle("removeLoadingVideo", "動画の前のイントロを消す", "授業動画の再生前に流れる大学のイントロ動画をスキップします。"),
                toggle("fasterBackAndForward", "戻る・進むを速くする", "ブラウザの戻る・進むボタンで、ページを読み込み直さずにすぐ表示します。"),
                toggle("fixSyllabusLink", "シラバスのリンクを修正", "右クリック禁止を解除し、検索結果から新しいタブで開けるようにします。"),
                toggle("fixPortalLink", "成績照会・科目登録メニューの待ち時間をなくす", "「ただいま処理中です」と表示されて10秒待たされるのを防ぎます。"),
                toggle("blockTracking", "IntelliBoard の閲覧記録を送らない", "Moodle の閲覧状況を記録する通信をブロックします。出席や成績に影響しないか、授業ごとに確認してから使ってください。"),
            ],
        },
        {
            id: "data",
            title: "データ",
            items: [custom(backupItem), custom(maintenanceItem)],
        },
        {
            id: "about",
            title: "この拡張機能について",
            items: [
                custom(() =>
                    el(
                        "div",
                        { class: "op-item is-block" },
                        el(
                            "div",
                            { class: "op-item-desc" },
                            "Waseda Moodle Plus は、",
                            el("a", { href: "https://github.com/mkihr-ojisan/better-waseda-moodle", target: "_blank" }, "Better Waseda Moodle"),
                            "（MIT License, © mkihr-ojisan）を参考に作った個人用の拡張機能です。早稲田大学の公式ツールではありません。Moodle やシラバスの仕様が変わると、一部の機能が動かなくなることがあります。"
                        )
                    )
                ),
            ],
        },
    ];

    // ===== 描画 =====

    const nav = document.getElementById("nav");
    const main = document.getElementById("main");

    // Firefox ではサイトへのアクセス許可がインストール時に出ないことがあるので、無ければ許可を求める
    const HOST_ACCESS = { origins: chrome.runtime.getManifest().host_permissions };
    let hasHostAccess = await chrome.permissions.contains(HOST_ACCESS);
    chrome.permissions.onAdded.addListener(async () => {
        hasHostAccess = await chrome.permissions.contains(HOST_ACCESS);
        render();
    });

    function render() {
        const scroll = window.scrollY;
        const welcome = new URLSearchParams(location.search).has("welcome")
            ? el(
                  "div",
                  { class: "op-welcome" },
                  el("h2", {}, "インストールありがとうございます"),
                  el(
                      "div",
                      {},
                      "Waseda Moodle を開くと、ダッシュボードに時間割と課題一覧が表示されます。まずは「時間割」の「シラバスから時間割を取得」を試してみてください。自動ログインを使う場合は「自動ログイン」でログイン情報を設定します。"
                  )
              )
            : null;
        const hostAccess = hasHostAccess
            ? null
            : el(
                  "div",
                  { class: "op-welcome" },
                  el("h2", {}, "サイトへのアクセスを許可してください"),
                  el("div", {}, "Waseda Moodle などのページを読み書きする許可が無いため、ほとんどの機能が動きません。"),
                  el(
                      "div",
                      { class: "row" },
                      el(
                          "button",
                          { class: "wmp-btn is-primary", onclick: () => chrome.permissions.request(HOST_ACCESS) },
                          "アクセスを許可"
                      )
                  )
              );
        main.replaceChildren(
            ...[hostAccess, welcome].filter(Boolean),
            ...SECTIONS.map((section) =>
                el(
                    "section",
                    { class: "wmp-card op-section", id: section.id },
                    el("header", { class: "wmp-card-header" }, el("h2", { class: "wmp-card-title" }, section.title)),
                    el("div", { class: "wmp-card-body" }, section.items.map(renderItem))
                )
            )
        );
        window.scrollTo(0, scroll);
    }

    nav.replaceChildren(...SECTIONS.map((s) => el("a", { href: `#${s.id}`, dataset: { id: s.id } }, s.title)));
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                nav.querySelectorAll("a").forEach((a) => a.classList.toggle("is-active", a.dataset.id === entry.target.id));
            }
        },
        { rootMargin: "-80px 0px -60% 0px" }
    );

    render();
    const observeSections = () => main.querySelectorAll(".op-section").forEach((s) => observer.observe(s));
    observeSections();
    new MutationObserver(observeSections).observe(main, { childList: true });

    // 別の画面（ポップアップなど）で設定が変わったら表示を更新
    WMP.onSettingsChanged((next) => {
        if (JSON.stringify(next) === JSON.stringify(settings)) return;
        settings = next;
        render();
    });
})();
