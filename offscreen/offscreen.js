// バックグラウンド（Service Worker）から渡された HTML を解析して返す（Chrome 用。Service Worker には DOMParser が無いため）。
import { parseHTMLWithDOM } from "../lib/html-parsers.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return;
    try {
        sendResponse({ ok: true, result: parseHTMLWithDOM(message.op, message.html) });
    } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
});
