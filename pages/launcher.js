// MyWaseda・成績照会などを、自動ログインを済ませた状態で開く。
(async () => {
    const WMP = globalThis.WMP;
    const { el } = WMP;
    WMP.applyUiTheme(await WMP.getSettings());

    const TITLES = {
        my_waseda: "MyWaseda",
        portal: "成績照会・科目登録専用メニュー",
        grade_inquiry: "成績照会",
        course_registration: "科目登録",
        waseda_email: "Waseda メール",
    };
    const target = new URLSearchParams(location.search).get("target");
    WMP.translateDom();
    document.getElementById("title").textContent = WMP.t("{name}を開いています", { name: WMP.t(TITLES[target] ?? "ページ") });

    try {
        const result = await WMP.send("prepareLaunch", { target });
        if (result.url) {
            location.replace(result.url);
            return;
        }
        const form = el("form", { method: "POST", action: result.action });
        for (const [name, value] of Object.entries(result.form)) {
            form.append(el("input", { type: "hidden", name, value }));
        }
        document.body.append(form);
        form.submit();
    } catch (e) {
        document.getElementById("card").replaceChildren(
            el("h1", {}, WMP.t("開けませんでした")),
            el("p", {}, e.message),
            el("a", { class: "wmp-btn", href: "https://my.waseda.jp/" }, WMP.t("MyWaseda を開く"))
        );
    }
})();
