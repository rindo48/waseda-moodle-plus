// HTML の解析。Firefox のバックグラウンドは普通のページなので DOMParser でその場で解析し、
// Chrome の Service Worker には DOMParser が無いので、オフスクリーンドキュメントに任せる。

import { parseHTMLWithDOM } from "../lib/html-parsers.js";

const OFFSCREEN_URL = "offscreen/offscreen.html";
let creating = null;

async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    if (contexts.length > 0) return;
    if (!creating) {
        creating = chrome.offscreen
            .createDocument({
                url: OFFSCREEN_URL,
                reasons: ["DOM_PARSER"],
                justification: "Moodle・シラバス・ログインページの HTML を解析するため",
            })
            .finally(() => (creating = null));
    }
    await creating;
}

/**
 * HTML を解析する。
 *
 * @param {"forms" | "syllabusSearch" | "syllabusDetail" | "oldSyllabusYears"} op - 解析の種類
 * @param {string} html - HTML
 */
export async function parseHTML(op, html) {
    if (typeof DOMParser === "function") return parseHTMLWithDOM(op, html);
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({ target: "offscreen", op, html });
    if (!response?.ok) throw new Error(response?.error ?? "HTML の解析に失敗しました");
    return response.result;
}
