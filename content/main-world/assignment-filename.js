// 課題提出ページでアップロードするファイルの名前を、指定した形式に変える。
// File.prototype.name を差し替えるため、ページ側（MAIN world）で動かす。
// テンプレートはコンテンツスクリプトから postMessage で受け取る。
(() => {
    const originalName = Object.getOwnPropertyDescriptor(File.prototype, "name").get;
    let template = null;
    let args = {};

    const format = (t, values) => Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v ?? ""), t);
    const sanitize = (s) => s.replace(/[\/:*?"<>|]/g, "_");

    const rename = (file) => {
        const name = originalName.call(file);
        if (!template) return name;
        const dot = name.lastIndexOf(".");
        const extension = dot > 0 ? name.slice(dot) : "";
        const filename = dot > 0 ? name.slice(0, dot) : name;
        return sanitize(format(template, { filename, extension, ...args }));
    };

    Object.defineProperty(File.prototype, "name", {
        configurable: true,
        get() {
            return rename(this);
        },
    });

    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data?.wmpAssignmentFilename) return;
        template = event.data.wmpAssignmentFilename.template;
        args = event.data.wmpAssignmentFilename.args ?? {};
    });

    // ファイルピッカーで選んだときは「名前を付けて保存」欄にも反映する
    document.addEventListener("change", (event) => {
        const input = event.target;
        if (input instanceof HTMLInputElement && input.name === "repo_upload_file" && input.files?.[0]) {
            const title = input.form?.querySelector("input[name=title]");
            if (title) title.value = rename(input.files[0]);
        }
    });
})();
