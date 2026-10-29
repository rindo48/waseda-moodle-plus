// Moodle のログインページの代わりに表示され、自動でログインしてから Moodle に戻る。
(async () => {
    const WMP = globalThis.WMP;
    const { el } = WMP;
    WMP.applyUiTheme(await WMP.getSettings());

    // 失敗してログインページに戻され続けるのを防ぐ（1分以内に3回目なら止める）
    const ATTEMPTS_KEY = "wmpAutoLoginAttempts";
    const now = Date.now();
    const attempts = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? "[]").filter((t) => now - t < 60 * 1000);
    attempts.push(now);
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));

    const showManual = (reason) => {
        document.getElementById("card").replaceChildren(
            el("h1", {}, "自動ログインできませんでした"),
            el("p", {}, reason),
            el(
                "div",
                { class: "row" },
                el("a", { class: "wmp-btn is-primary", href: WMP.SAML_LOGIN_URL }, "手動でログイン"),
                el("button", { class: "wmp-btn", onclick: () => chrome.runtime.openOptionsPage() }, "設定を開く")
            )
        );
    };

    if (attempts.length >= 3) {
        showManual("短時間に何度もログインし直しているため、自動ログインを止めました。ID・パスワードが正しいか確認してください。");
        return;
    }

    try {
        await WMP.send("autoLogin");
        // ブラウザ側で SAML のログインを完了させると、Moodle がトップページに戻してくれる
        location.replace(WMP.SAML_LOGIN_URL);
    } catch (e) {
        showManual(e.message);
    }
})();
