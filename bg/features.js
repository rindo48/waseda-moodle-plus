// 設定に合わせて、ネットワークルール（declarativeNetRequest）と動的コンテンツスクリプトを切り替える。

const { getSettings, LOGIN_INFO_KEY } = globalThis.WMP;

const MOODLE = "https://wsdmoodle.waseda.jp/*";

/** 設定 → 有効にする静的ルールセット */
function enabledRulesets(settings, hasLoginInfo) {
    return {
        "auto-login": settings.autoLoginEnabled && hasLoginInfo,
        "block-tracking": settings.blockTracking,
        "faster-back-and-forward": settings.fasterBackAndForward,
        "fix-portal-link": settings.fixPortalLink,
        "remove-loading-video": settings.removeLoadingVideo,
        "view-in-browser": settings.viewInBrowser,
    };
}

/** 設定 → 登録する動的コンテンツスクリプト */
function contentScripts(settings) {
    const scripts = [];
    const add = (enabled, script) => enabled && scripts.push({ persistAcrossSessions: true, ...script });

    add(settings.darkMode !== "off", {
        id: "dark-mode",
        matches: [MOODLE],
        js: [settings.darkMode === "on" ? "content/dark-mode-on.js" : "content/dark-mode-auto.js", "content/dark-mode-inline-colors.js", "content/dark-mode-editor.js"],
        css: [settings.darkModeMethod === "invert" ? "styles/dark-invert.css" : "styles/dark-theme.css"],
        runAt: "document_start",
        allFrames: true,
    });
    add(settings.modernLook, { id: "modern-look", matches: [MOODLE], css: ["styles/modern-look.css"], runAt: "document_start" });
    add(settings.reduceCourseContentPadding, {
        id: "reduce-course-content-padding",
        matches: [MOODLE],
        css: ["styles/reduce-course-content-padding.css"],
        runAt: "document_start",
    });
    add(settings.removeFloatingActionButtons, {
        id: "remove-floating-action-buttons",
        matches: [MOODLE],
        css: ["styles/remove-floating-action-buttons.css"],
        runAt: "document_start",
    });
    add(settings.removeNotificationBadge, {
        id: "remove-notification-badge",
        matches: [MOODLE],
        css: ["styles/remove-notification-badge.css"],
        runAt: "document_start",
    });
    add(settings.quizRemainingTimeEnabled, {
        id: "quiz-remaining-time",
        matches: ["https://wsdmoodle.waseda.jp/mod/quiz/attempt.php*"],
        css: ["styles/quiz-remaining-time.css"],
    });
    add(settings.fasterBackAndForward, {
        id: "faster-back-and-forward",
        matches: [MOODLE],
        js: ["content/main-world/faster-back-and-forward.js"],
        runAt: "document_start",
        world: "MAIN",
    });
    add(settings.assignmentFilenameEnabled, {
        id: "assignment-filename",
        matches: ["https://wsdmoodle.waseda.jp/mod/assign/view.php*"],
        js: ["content/main-world/assignment-filename.js"],
        runAt: "document_start",
        world: "MAIN",
    });
    add(settings.fixSyllabusLink, {
        id: "fix-syllabus-link",
        matches: [
            "https://www.wsl.waseda.jp/syllabus/JAA101.php*",
            "https://www.wsl.waseda.jp/syllabus/JAA102.php*",
            "https://www.wsl.waseda.jp/syllabus/index.php*",
        ],
        js: ["content/main-world/fix-syllabus-link.js"],
        runAt: "document_idle",
        world: "MAIN",
    });
    add(settings.fixPortalLink, {
        id: "fix-portal-link",
        matches: ["https://coursereg.waseda.jp/portal/simpleportal.php*"],
        js: ["content/main-world/fix-portal-link.js"],
        runAt: "document_end",
        world: "MAIN",
    });
    return scripts;
}

const DARK_CSS = { theme: "styles/dark-theme.css", invert: "styles/dark-invert.css" };

/**
 * 開いている Moodle のタブにダークモードの設定をその場で反映する。
 * 登録済みのコンテンツスクリプトは次に開いたページから効くので、今のページには CSS を直接差し込む。
 */
export async function applyDarkModeToOpenTabs() {
    const settings = await getSettings();
    const tabs = await chrome.tabs.query({ url: MOODLE });
    await Promise.all(
        tabs.map(async (tab) => {
            const target = { tabId: tab.id, allFrames: true };
            try {
                await chrome.scripting.removeCSS({ target, files: Object.values(DARK_CSS) });
                if (settings.darkMode !== "off") {
                    await chrome.scripting.insertCSS({ target, files: [DARK_CSS[settings.darkModeMethod] ?? DARK_CSS.theme] });
                }
                await chrome.scripting.executeScript({
                    target,
                    args: [settings.darkMode],
                    func: (mode) => {
                        const on = mode === "on" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
                        document.documentElement.classList.toggle("wmp-dark", on);
                    },
                });
                if (settings.darkMode !== "off") {
                    await chrome.scripting.executeScript({ target, files: ["content/dark-mode-inline-colors.js", "content/dark-mode-editor.js"] });
                }
            } catch (e) {
                // 読み込み中や破棄されたタブには反映できないが、次に開いたときに効くので無視する
                console.debug("failed to apply dark mode", tab.id, e);
            }
        })
    );
}

let syncing = Promise.resolve();

/** 設定を読み直して、ルールとスクリプトを反映する。連続で呼ばれても順番に処理する */
export function syncFeatures() {
    syncing = syncing.then(doSync).catch((e) => console.error("syncFeatures failed", e));
    return syncing;
}

async function doSync() {
    const settings = await getSettings();
    const { [LOGIN_INFO_KEY]: loginInfo } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    const hasLoginInfo = Boolean(loginInfo?.userId && loginInfo?.password);

    // --- 静的ルールセット ---
    const wanted = enabledRulesets(settings, hasLoginInfo);
    const current = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
    const enableRulesetIds = Object.keys(wanted).filter((id) => wanted[id] && !current.has(id));
    const disableRulesetIds = Object.keys(wanted).filter((id) => !wanted[id] && current.has(id));
    if (enableRulesetIds.length || disableRulesetIds.length) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    }

    // --- 拡張機能からの Moodle API 呼び出しだけ、モバイルアプリの User-Agent にする（元の拡張機能と同じ挙動） ---
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: [
            {
                id: 1,
                priority: 1,
                condition: {
                    urlFilter: "|https://wsdmoodle.waseda.jp/lib/ajax/service.php*",
                    initiatorDomains: [chrome.runtime.id],
                    resourceTypes: ["xmlhttprequest", "other"],
                },
                action: {
                    type: "modifyHeaders",
                    requestHeaders: [{ header: "User-Agent", operation: "set", value: "MoodleMobile" }],
                },
            },
        ],
    });

    // --- 動的コンテンツスクリプト ---
    const registered = await chrome.scripting.getRegisteredContentScripts();
    if (registered.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
    }
    const scripts = contentScripts(settings);
    if (scripts.length > 0) await chrome.scripting.registerContentScripts(scripts);
}
