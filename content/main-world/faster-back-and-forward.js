// ページの unload イベントを無効にして、戻る・進むで即座にページを表示できるようにする（bfcache を効かせる）。
(() => {
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this === window && type === "unload") return;
        return original.call(this, type, listener, options);
    };
})();
