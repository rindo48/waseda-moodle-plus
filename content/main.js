// Waseda Moodle の全ページで最初に動くスクリプト。設定を読んで各機能を起動する。
(async () => {
    const WMP = globalThis.WMP;
    const settings = await WMP.getSettings();

    WMP.initFeatures(settings);

    if (location.pathname === "/my/" || location.pathname === "/my/index.php") {
        WMP.initDashboard(settings);
    }
})();
