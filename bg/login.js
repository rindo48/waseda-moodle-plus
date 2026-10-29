// Waseda のシングルサインオン（Microsoft Entra ID → 早稲田 IdP → 各サービス）を自動で通過する。
// 流れは better-waseda-moodle の login.ts と同じ。

import { parseHTML } from "./parse.js";

const { LOGIN_INFO_KEY, SAML_LOGIN_URL, MOODLE_ORIGIN } = globalThis.WMP;

const MS_LOGIN_URL = "https://login.microsoftonline.com/b3865172-9887-4b3a-89ff-95a35b92f4c3/login";
const WASEDA_IDP_URL = "https://iaidp.ia.waseda.jp/idp/profile/Authn/SAML2/POST/SSO";
const MOODLE_ACS_URL = "https://wsdmoodle.waseda.jp/auth/saml2/sp/saml2-acs.php/wsdmoodle.waseda.jp";

export class LoginRequiredError extends Error {
    constructor() {
        super("ログイン情報が設定されていません。設定画面で自動ログインを設定してください。");
        this.name = "LoginRequiredError";
    }
}

export async function getLoginInfo() {
    const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    if (!info?.userId || !info?.password) throw new LoginRequiredError();
    return info;
}

function fetchWithCredentials(url, init = {}) {
    return fetch(url, { credentials: "include", ...init });
}

async function postForm(url, form, init = {}) {
    return fetchWithCredentials(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        ...init,
    });
}

async function postFormAndParse(url, form) {
    const response = await postForm(url, form);
    return parseHTML("forms", await response.text());
}

/** Microsoft のサインインフォームに ID・パスワードを送る */
async function submitMicrosoftLogin(msConfig) {
    const { userId, password } = await getLoginInfo();
    return postFormAndParse(MS_LOGIN_URL, {
        i13: "0",
        login: userId,
        loginfmt: userId,
        type: "11",
        LoginOptions: "3",
        lrt: "",
        lrtPartition: "",
        hisRegion: "",
        hisScaleUnit: "",
        passwd: password,
        ps: "2",
        psRNGCDefaultType: "",
        psRNGCEntropy: "",
        psRNGCSLK: "",
        canary: msConfig.canary,
        ctx: msConfig.sCtx,
        hpgrequestid: msConfig.sessionId,
        flowToken: msConfig.sFT,
        PPSX: "",
        NewUser: "1",
        FoundMSAs: "",
        fspost: "0",
        i21: "0",
        CookieDisclosure: "0",
        IsFidoSupported: "0",
        isSignupPost: "0",
        isRecoveryAttemptPost: "0",
        i19: "14162",
    });
}

/**
 * ある URL を開いたときに出てくる SSO の画面を、サービス側のフォームが出るところまで進める。
 * Moodle 以外（成績照会・科目登録など）でも使う。
 *
 * @param {string} startUrl - 最初に開く URL
 * @param {string} spAcsUrl - サービス側の SAML 受け取り URL（ここに POST するフォームが出たら止まる）
 * @returns {Promise<{page, finalSpForm}>} - 最後に解析したページと、サービス側へ送るべきフォーム
 */
export async function walkSSO(startUrl, spAcsUrl) {
    let page = await parseHTML("forms", await (await fetchWithCredentials(startUrl)).text());

    if (page.msConfig) {
        page = await submitMicrosoftLogin(page.msConfig);
        if (page.msConfig && !page.forms.some((f) => f.action === WASEDA_IDP_URL)) {
            // まだ Microsoft の画面にいる = パスワード違いや多要素認証など
            throw new Error(
                "Microsoft のサインインを自動で通過できませんでした。ID・パスワードを確認するか、手動でログインしてください。"
            );
        }
    }

    const idpForm = page.forms.find((f) => f.action === WASEDA_IDP_URL);
    if (idpForm) {
        page = await postFormAndParse(WASEDA_IDP_URL, { ...page.allHidden, ...idpForm.hidden });
    }

    const spForm = page.forms.find((f) => f.action === spAcsUrl);
    return { page, spForm };
}

let loginPromise = null;

/**
 * Waseda Moodle にログインする。同時に呼ばれた場合は1回にまとめる。
 *
 * @param {{ skipCheck?: boolean, skipFinalRedirect?: boolean }} options
 * @returns {Promise<string | undefined>} - ログイン後のセッションキー
 */
export function loginToMoodle(options = {}) {
    if (!loginPromise) {
        loginPromise = doLogin(options).finally(() => (loginPromise = null));
    }
    return loginPromise;
}

async function doLogin({ skipCheck = false, skipFinalRedirect = false } = {}) {
    if (!skipCheck) {
        const key = await fetchSessionKeyFromPage();
        if (key) return key;
    }

    await getLoginInfo(); // ログイン情報が無ければここで LoginRequiredError

    const { spForm } = await walkSSO(SAML_LOGIN_URL, MOODLE_ACS_URL);
    if (!spForm) throw new Error("Moodle のログインフォームが見つかりませんでした（ログイン手順が変わった可能性があります）");

    await postForm(MOODLE_ACS_URL, spForm.hidden, { redirect: "manual" });
    if (!skipFinalRedirect) {
        await fetchWithCredentials(SAML_LOGIN_URL, { redirect: "manual" });
    }

    const key = await fetchSessionKeyFromPage();
    if (!key && !skipFinalRedirect) throw new Error("ログインしましたがセッションキーを取得できませんでした");
    return key;
}

/** ログイン済みなら Moodle のページからセッションキーを取り出す。未ログインなら null */
export async function fetchSessionKeyFromPage() {
    const response = await fetchWithCredentials(`${MOODLE_ORIGIN}/user/preferences.php`);
    if (response.url.startsWith(`${MOODLE_ORIGIN}/login/`)) return null;
    const text = await response.text();
    return (
        text.match(/\/login\/logout\.php\?sesskey=([^"&]+)"/)?.[1] ??
        text.match(/"sesskey":"([^"]+)"/)?.[1] ??
        null
    );
}
