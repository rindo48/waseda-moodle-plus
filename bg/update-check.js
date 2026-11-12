// 新しいバージョンのお知らせ。
// GitHub から入れた拡張機能はブラウザが自動で更新しないので、1日1回 GitHub の最新リリースを確かめ、
// 今より新しければ通知を1回だけ出し、ポップアップと設定画面にも案内を出す（更新そのものは手動）。
//
// リリースの作り方: manifest.json の version を上げ、GitHub で「v1.2.3」のようなタグのリリースを作る。
// 下書き・プレリリースは releases/latest に出ないので、お知らせの対象にならない。
// ストアから入れた場合はブラウザが更新するので、このお知らせは出さない（update_url が付くので見分けられる）。

export const UPDATE_ALARM = "wmp-update-check";
export const UPDATE_INFO_KEY = "updateInfo";
const NOTIFICATION_ID = "wmp-update";
const LATEST_URL = "https://api.github.com/repos/rindo48/waseda-moodle-plus/releases/latest";
const RELEASES_PAGE = "https://github.com/rindo48/waseda-moodle-plus/releases/latest";

/** "v1.2.3" / "1.2.3" → [1, 2, 3]。読めなければ null */
function parseVersion(text) {
    const m = String(text ?? "").trim().match(/^v?(\d+(?:\.\d+){0,3})$/i);
    return m ? m[1].split(".").map(Number) : null;
}

/** a が b より新しいか */
function isNewer(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d > 0;
    }
    return false;
}

/** ストアから入れたもの（ブラウザが自動で更新する）か */
function installedFromStore() {
    return Boolean(chrome.runtime.getManifest().update_url);
}

/**
 * 最新リリースを確かめ、結果を保存する。新しい版を初めて見つけたときだけ通知する。
 * 通信に失敗したとき・リリースがまだ無いときは、前回の結果をそのまま残す。
 */
export async function checkForUpdate(settings) {
    if (!settings.updateCheckEnabled || installedFromStore()) {
        await chrome.storage.local.remove(UPDATE_INFO_KEY);
        return;
    }
    let release;
    try {
        const res = await fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
        if (!res.ok) return;
        release = await res.json();
    } catch {
        return;
    }
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(chrome.runtime.getManifest().version);
    if (!latest || !current) return;

    const { [UPDATE_INFO_KEY]: before } = await chrome.storage.local.get(UPDATE_INFO_KEY);
    if (!isNewer(latest, current)) {
        await chrome.storage.local.remove(UPDATE_INFO_KEY);
        return;
    }
    const info = { version: latest.join("."), url: release.html_url || RELEASES_PAGE, notified: before?.version === latest.join(".") && before.notified };
    if (!info.notified) {
        chrome.notifications.create(NOTIFICATION_ID, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
            title: "Waseda Moodle Plus の新しいバージョン",
            message: `バージョン ${info.version} が出ています（今は ${current.join(".")}）。クリックするとダウンロードのページを開きます。`,
        });
        info.notified = true;
    }
    await chrome.storage.local.set({ [UPDATE_INFO_KEY]: info });
}

/** 通知を押したとき: リリースのページを開く。この通知でなければ false */
export async function handleUpdateNotificationClick(notificationId) {
    if (notificationId !== NOTIFICATION_ID) return false;
    const { [UPDATE_INFO_KEY]: info } = await chrome.storage.local.get(UPDATE_INFO_KEY);
    await chrome.tabs.create({ url: info?.url ?? RELEASES_PAGE });
    chrome.notifications.clear(notificationId);
    return true;
}
