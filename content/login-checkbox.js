// Microsoft のサインイン画面に「自動ログインを有効にする」チェックボックスを付ける。
// チェックしてサインインすると、入力した ID・パスワードをこの拡張機能に保存する。
(async () => {
    const WMP = globalThis.WMP;
    const settings = await WMP.getSettings();
    if (settings.autoLoginEnabled) return;

    const CHECKBOX_ID = "wmp-auto-login-checkbox";

    const insert = () => {
        if (document.getElementById(CHECKBOX_ID)) return;
        const passwordInput = document.querySelector("input[name=passwd]");
        const signIn = document.getElementById("idSIButton9");
        if (!passwordInput || !signIn || passwordInput.offsetParent === null) return;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = CHECKBOX_ID;
        const label = document.createElement("label");
        label.htmlFor = CHECKBOX_ID;
        label.textContent = "Waseda Moodle Plus で自動ログインを有効にする";
        label.style.cssText = "margin-left:.5em;font-size:.85em;line-height:1";
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;margin:.75em 0";
        row.append(checkbox, label);
        (signIn.closest(".row, .win-button-pin-bottom") ?? signIn.parentElement).insertAdjacentElement("beforebegin", row);

        const save = () => {
            if (!checkbox.checked) return;
            const userId =
                document.querySelector("input[name=loginfmt]")?.value ||
                document.querySelector("input[name=login]")?.value ||
                document.querySelector("#displayName")?.textContent?.trim();
            const password = passwordInput.value;
            if (!userId || !password) return;
            chrome.storage.local.set({ [WMP.LOGIN_INFO_KEY]: { userId, password } });
            WMP.setSettings({ autoLoginEnabled: true });
        };
        signIn.addEventListener("click", save, true);
        passwordInput.addEventListener("keydown", (e) => e.key === "Enter" && save(), true);
    };

    new MutationObserver(insert).observe(document.body, { childList: true, subtree: true, attributes: true });
    insert();
})();
