// 新デザイン: 科目のカテゴリー（/course/index.php?categoryid=…）。
// 早稲田の Moodle では、学生にはカテゴリーの中の科目が表示されず、見出しだけの空のページになる。
// - パンくずのカテゴリー（「非正規科目 / 26基幹理工学部 / 2021」など）は押しても空のページに行くだけなので、
//   どのページでもリンクを外して文字にする（initNewCategoryLinks）
// - それでも開いたときは、空のページの代わりに案内を出す。見出しが年度（「2021」など）なら、
//   受講した科目のうちその年度のものを並べる（initNewCategory）

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
    const main = document.querySelector("#region-main [role='main']") ?? document.querySelector("#region-main");
    if (!main) return;

    // 科目やカテゴリーの一覧が出ているなら（先生などの権限がある場合）、Moodle の表示のままにする
    const listed = main.querySelector('a[href*="/course/view.php?id="], .subcategories a[href*="/course/index.php"], .category-browse .coursebox');
    if (listed) return;

    const heading = document.querySelector("#page-header h1, .page-header-headings h1, h1")?.textContent.trim() ?? "";
    const year = /^\d{4}$/.test(heading) ? Number(heading) : null;

    const box = el("section", { class: "wmp-scope wmp-card wmp-category-empty" });
    main.append(box);

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
        )
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
