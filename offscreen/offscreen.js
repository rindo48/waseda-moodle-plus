// バックグラウンドから渡された HTML を DOMParser で解析して、必要な情報だけを返す。

const parsers = {
    /** ログイン処理用: 最初の script の $Config と、各フォームの action / hidden input */
    forms(doc) {
        const firstScript = doc.getElementsByTagName("script")[0]?.textContent ?? "";
        let msConfig = null;
        const match = firstScript.match(/\$Config=(\{[\s\S]*\});?\s*(\/\/\]\]>)?\s*$/);
        if (match) {
            try {
                msConfig = JSON.parse(match[1]);
            } catch {
                msConfig = null;
            }
        }
        const forms = Array.from(doc.getElementsByTagName("form")).map((form) => ({
            name: form.getAttribute("name"),
            action: form.getAttribute("action"),
            hidden: Object.fromEntries(
                Array.from(form.querySelectorAll('input[type="hidden"]')).map((e) => [
                    e.getAttribute("name"),
                    e.getAttribute("value") ?? "",
                ])
            ),
        }));
        // フォームの外にある hidden input も拾う（SAML の自動送信ページ用）
        const allHidden = Object.fromEntries(
            Array.from(doc.querySelectorAll('input[type="hidden"]')).map((e) => [
                e.getAttribute("name"),
                e.getAttribute("value") ?? "",
            ])
        );
        return { msConfig, forms, allHidden };
    },

    /** シラバス検索結果の表 */
    syllabusSearch(doc) {
        const message = doc.getElementsByClassName("ch-message")[0]?.textContent?.trim();
        if (message === "検索結果は0件です。" || message === "0 Search Result") return [];

        const table = doc.getElementsByClassName("ct-vh")[0];
        if (!table) throw new Error("シラバス検索結果の表が見つかりません");

        const results = [];
        const rows = table.getElementsByTagName("tr");
        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].getElementsByTagName("td");
            const key = cells[2]
                ?.getElementsByTagName("a")[0]
                ?.getAttribute("onclick")
                ?.match(/post_submit\('JAA104DtlSubCon', '(.*)'\)/)?.[1];
            if (!key) continue;
            results.push({
                year: parseInt(cells[0].textContent.trim()) || undefined,
                courseCode: cells[1].textContent.trim(),
                courseTitle: cells[2].textContent.trim(),
                instructors: cells[3].textContent.trim().split("／"),
                term: cells[5].textContent.trim(),
                dayPeriod: cells[6].textContent.trim(),
                classroom: cells[7].textContent.trim(),
                key,
            });
        }
        return results;
    },

    /** シラバス詳細ページの「授業情報」表を { 見出し: 値 } にする */
    syllabusDetail(doc) {
        const table = doc.getElementsByClassName("ct-common")[0];
        if (!table) throw new Error("シラバスの授業情報が見つかりません");
        const info = {};
        for (const th of Array.from(table.getElementsByTagName("th"))) {
            const td = th.nextElementSibling;
            if (!td || td.nodeName.toUpperCase() !== "TD") continue;
            info[th.textContent.trim()] = td.textContent.trim();
        }
        return info;
    },

    /** 過年度シラバス検索の年度一覧 */
    oldSyllabusYears(doc) {
        const options = Array.from(doc.getElementById("nendo")?.getElementsByTagName("option") ?? []);
        return options
            .slice(1)
            .map((o) => parseInt(o.getAttribute("value") ?? "", 10))
            .filter((n) => !Number.isNaN(n));
    },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return;
    try {
        const parser = parsers[message.op];
        if (!parser) throw new Error(`unknown op: ${message.op}`);
        const doc = new DOMParser().parseFromString(message.html, "text/html");
        sendResponse({ ok: true, result: parser(doc) });
    } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
});
