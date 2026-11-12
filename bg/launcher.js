// ツールバーアイコンの右クリックメニューから、よく使うページを開く。

import { getLoginInfo, walkSSO } from "./login.js";
import { parseHTML } from "./parse.js";

const launcherUrl = (target) => chrome.runtime.getURL(`pages/launcher.html?target=${target}`);

const MENUS = [
    { id: "open-moodle", title: "Waseda Moodle", url: () => "https://wsdmoodle.waseda.jp/my/" },
    { id: "open-my-waseda", title: "MyWaseda", url: () => launcherUrl("my_waseda") },
    { id: "open-syllabus", title: "シラバス検索", url: () => "https://www.wsl.waseda.jp/syllabus/JAA101.php" },
    { id: "portal", title: "成績照会・科目登録" },
    { id: "open-grade-inquiry", parentId: "portal", title: "成績照会", url: () => launcherUrl("grade_inquiry") },
    { id: "open-course-registration", parentId: "portal", title: "科目登録", url: () => launcherUrl("course_registration") },
    { id: "open-portal", parentId: "portal", title: "成績照会・科目登録専用メニュー", url: () => launcherUrl("portal") },
    { id: "open-waseda-email", parentId: "portal", title: "Waseda メール", url: () => launcherUrl("waseda_email") },
    { id: "open-settings", title: "Waseda Moodle Plus の設定", url: () => chrome.runtime.getURL("options/options.html") },
];

export async function createLauncherMenus() {
    // 言語を決めてから作る（設定・最後に開いた Moodle の言語を読む）
    await globalThis.WMP.getSettings();
    await chrome.contextMenus.removeAll();
    for (const menu of MENUS) {
        chrome.contextMenus.create({ id: menu.id, title: globalThis.WMP.t(menu.title), parentId: menu.parentId, contexts: ["action"] });
    }
}

export function handleLauncherClick(info) {
    const menu = MENUS.find((m) => m.id === info.menuItemId);
    if (menu?.url) chrome.tabs.create({ url: menu.url() });
}

// ===== ログインが必要なページを開く準備 =====


const COURSEREG_PORTAL = "https://coursereg.waseda.jp/portal/simpleportal.php?HID_P14=JA";
const COURSEREG_ACS = "https://coursereg.waseda.jp/Shibboleth.sso/SAML2/POST";
const MYWASEDA_TOP = "https://my.waseda.jp/portal/view/portal-top-view";
const MYWASEDA_ACS = "https://my.waseda.jp/Shibboleth.sso/SAML2/POST";

/** 専用メニューの F01 フォームに足す値（better-waseda-moodle と同じ） */
const PORTAL_TARGETS = {
    grade_inquiry: { url: "https://gradereport-ty.waseda.jp/kyomu/epb2050.htm", HID_P6: "eStudent", HID_P8: "ea02", pageflag: "1000", status: "1" },
    course_registration: { url: "https://wcrs.waseda.jp/kyomu/epb1110.htm", HID_P6: "eStudent", HID_P8: "ea02", pageflag: "1000", status: "0" },
    waseda_email: { frame: "0", pageflag: "1001", NewOldFlg: "0" },
};

/**
 * ランチャーページから呼ばれる。SSO を済ませたうえで、ブラウザで送信すべきフォーム（または開くURL）を返す。
 *
 * @returns {Promise<{ url: string } | { action: string, form: Record<string, string> }>}
 */
export async function prepareLaunch(target) {
    const fallback = {
        my_waseda: { url: "https://my.waseda.jp/" },
        portal: { url: COURSEREG_PORTAL },
        grade_inquiry: { url: COURSEREG_PORTAL },
        course_registration: { url: COURSEREG_PORTAL },
        waseda_email: { url: COURSEREG_PORTAL },
    }[target];
    if (!fallback) throw new Error(globalThis.WMP.t("不明なページです: {target}", { target }));

    try {
        await getLoginInfo();
    } catch {
        return fallback; // 自動ログイン未設定なら普通に開いて手動でログインしてもらう
    }

    if (target === "my_waseda") {
        const { spForm } = await walkSSO(MYWASEDA_TOP, MYWASEDA_ACS);
        if (spForm) return { action: MYWASEDA_ACS, form: spForm.hidden };
        return { url: MYWASEDA_TOP }; // 既にログイン済み
    }

    const { page, spForm } = await walkSSO(COURSEREG_PORTAL, COURSEREG_ACS);
    if (target === "portal") {
        return spForm ? { action: COURSEREG_ACS, form: spForm.hidden } : { url: COURSEREG_PORTAL };
    }

    let portalPage = page;
    if (spForm) {
        const response = await fetch(COURSEREG_ACS, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(spForm.hidden).toString(),
        });
        portalPage = await parseHTML("forms", await response.text());
    }
    const f01 = portalPage.forms.find((f) => f.name === "F01");
    if (!f01) return fallback;
    return { action: "https://coursereg.waseda.jp/portal/simpleportal.php", form: { ...f01.hidden, ...PORTAL_TARGETS[target] } };
}
