// Waseda Moodle の全ページで最初に動くスクリプト。設定を読んで各機能を起動する。
(async () => {
    const WMP = globalThis.WMP;
    const settings = await WMP.getSettings();

    WMP.initFeatures(settings);

    const isNewDesign = settings.design === "new";
    // 設定を旧デザインに戻した直後は、新デザインの目印を付けるスクリプトの登録がまだ残っていることがあるので外す
    if (!isNewDesign) {
        document.documentElement.classList.remove("wmp-new", "wmp-has-rail", "wmp-rail-collapsed");
        delete document.documentElement.dataset.wmpDesign;
    }
    const path = location.pathname;

    // 新デザイン: 上のタブの代わりに左のメニューと検索を置く（全ページ）
    if (isNewDesign) {
        try {
            WMP.initNewShell(settings);
        } catch (e) {
            // メニューを出せなくても、上のタブは隠していないのでそのまま使える
            document.documentElement.classList.remove("wmp-has-rail");
            console.error("Waseda Moodle Plus: 左のメニューを出せませんでした", e);
        }
    }

    if (path === "/my/" || path === "/my/index.php") {
        WMP.initDashboard(settings);
        // 新デザインでは、時間割と課題一覧の上に「今日」をまとめる（initDashboard が置いた欄の前に入れる）
        if (isNewDesign) WMP.initNewHome(settings);
    }
    if (!isNewDesign) return;

    if (path === "/" || path === "/index.php") WMP.initNewSiteHome(settings);
    if (path === "/my/courses.php") WMP.initNewMyCourses(settings);
    if (path === "/calendar/view.php") WMP.initNewCalendar(settings);
    if (path === "/course/view.php") WMP.initNewCourse(settings);
})();
