// 新デザイン: 科目のカテゴリー（/course/index.php?categoryid=…）。
// 早稲田の Moodle では、学生にはカテゴリーの中身（科目の一覧・カテゴリーの切り替え）を CSS で隠していて
// （#region-main が display: none）、見出しだけの空のページに見える。中身自体はページに入っている。
// - パンくずのカテゴリー（「非正規科目 / 26基幹理工学部 / 2021」など）は押しても空のページに行くだけなので、
//   どのページでもリンクを外して文字にする（initNewCategoryLinks）
// - それでも開いたときは、空のページの代わりに案内を出す。見出しが年度（「2021」など）なら、
//   受講した科目のうちその年度のものを並べる。隠された Moodle の一覧を出すボタンも付ける（initNewCategory）

/** パンくずの中のカテゴリーへのリンクを、ただの文字にする（全ページ） */
globalThis.WMP.initNewCategoryLinks = function initNewCategoryLinks() {
    for (const a of document.querySelectorAll('.breadcrumb a[href*="/course/index.php"]')) {
        const span = document.createElement("span");
        span.className = "wmp-crumb-text";
        span.textContent = a.textContent;
        a.replaceWith(span);
    }
};

globalThis.WMP.initNewCategory = async function initNewCategory(settings) {
    const WMP = globalThis.WMP;
    const { el, icon } = WMP;
    const region = document.querySelector("#region-main");
    if (!region) return;
    const hasList = Boolean(region.querySelector('a[href*="/course/view.php?id="], .subcategories a[href*="/course/index.php"]'));
    const hidden = getComputedStyle(region).display === "none";
    // 一覧が見えているなら（先生など）、Moodle の表示のままにする
    if (hasList && !hidden) return;

    // 隠された Moodle の一覧を出すかどうか（前回の選択を覚えておく）
    const SHOW_KEY = "wmpShowCategoryList";
    const setShown = (show) => {
        document.documentElement.classList.toggle("wmp-show-category-list", show);
        localStorage.setItem(SHOW_KEY, show ? "1" : "0");
        if (toggle) toggle.replaceChildren(icon(show ? "eyeOff" : "eye", { size: 16 }), show ? WMP.t("Moodle のカテゴリー一覧を隠す") : WMP.t("Moodle のカテゴリー一覧を表示"));
    };
    let toggle = null;

    const heading = document.querySelector("#page-header h1, .page-header-headings h1, h1")?.textContent.trim() ?? "";
    const year = /^\d{4}$/.test(heading) ? Number(heading) : null;

    const box = el("section", { class: "wmp-scope wmp-card wmp-category-empty" });
    // #region-main が隠されていても見えるように、その外（前）に置く
    region.insertAdjacentElement("beforebegin", box);
    if (hasList) {
        toggle = el("button", { type: "button", class: "wmp-btn", onclick: () => setShown(!document.documentElement.classList.contains("wmp-show-category-list")) });
        setShown(localStorage.getItem(SHOW_KEY) === "1");
    }

    const actions = el(
        "div",
        { class: "wmp-category-actions" },
        el("a", { class: "wmp-btn is-primary", href: "/my/courses.php" }, icon("courses", { size: 16 }), WMP.t("マイコースを開く")),
        el(
            "button",
            {
                type: "button",
                class: "wmp-btn",
                // 新デザインの検索（Ctrl+K）を開く
                onclick: () => document.querySelector(".wmp-search-trigger")?.click(),
            },
            icon("search", { size: 16 }),
            WMP.t("科目・締切・ページを探す")
        ),
        toggle
    );
    const intro = el(
        "div",
        { class: "wmp-category-intro" },
        el("h2", {}, WMP.t("このページには科目が表示されません")),
        el("p", { class: "wmp-muted" }, WMP.t("早稲田の Moodle では、学生はカテゴリーから科目を探せないようになっています。受講している科目は、マイコースか検索から開いてください。")),
        actions
    );
    box.replaceChildren(intro);
    if (!year) return;

    // 見出しが年度なら、受講した科目のうちその年度のものを並べる
    let courses = [];
    try {
        courses = (await WMP.send("getCourses")).value ?? [];
    } catch {
        return;
    }
    const mine = courses
        .filter((c) => c.year === year)
        .sort((a, b) => WMP.courseName(settings, a).localeCompare(WMP.courseName(settings, b), WMP.locale()));
    if (mine.length === 0) return;
    box.append(
        el("h3", { class: "wmp-category-list-title" }, WMP.t("{year}年度に受講した科目（{count}）", { year, count: mine.length })),
        el(
            "ul",
            { class: "wmp-category-list" },
            mine.map((c) =>
                el(
                    "li",
                    {},
                    el(
                        "a",
                        { class: "wmp-category-course", href: c.url, style: { "--wmp-course-color": WMP.courseColor(settings, c.id) } },
                        el("span", { class: "wmp-category-mark", "aria-hidden": "true" }, WMP.courseInitial(WMP.courseName(settings, c))),
                        el("span", { class: "wmp-category-name" }, WMP.courseName(settings, c))
                    )
                )
            )
        )
    );
};
