// 自動ログインのパスワードを暗号化して保存する。
//
// 鍵は AES-GCM で、「取り出せない」（extractable: false）設定で作り、この拡張機能の IndexedDB に置く。
// 鍵はこの拡張機能の中のコードからしか使えず、JavaScript から鍵の中身を取り出すこともできない。
// そのため、chrome.storage の保存ファイルや書き出した JSON を見ただけでは、パスワードは読めない。
// ただし、鍵もこのパソコンの中にあるので、パソコンを自由に操作できる人やマルウェアまでは防げない。
//
// 保存の形: loginInfo = { userId, encPassword: { v: 1, iv, data } }（iv・data は Base64）
// 以前の版は loginInfo = { userId, password }（暗号化なし）。見つけたら暗号化した形に置き換える。

const { LOGIN_INFO_KEY } = globalThis.WMP;

const DB_NAME = "wmp-secrets";
const STORE = "keys";
const KEY_ID = "loginInfo";

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idb(db, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function withDb(fn) {
    const db = await openDb();
    try {
        return await fn(db);
    } finally {
        db.close();
    }
}

// 同時に呼ばれても、読み出し・作成はそれぞれ1回にまとめる
let loadPromise = null;
let createPromise = null;

function loadKey() {
    loadPromise ??= withDb((db) => idb(db, "readonly", (s) => s.get(KEY_ID))).finally(() => (loadPromise = null));
    return loadPromise;
}

function createKey() {
    createPromise ??= withDb(async (db) => {
        // 待っている間に別の呼び出しが作っていたら、そちらを使う
        const existing = await idb(db, "readonly", (s) => s.get(KEY_ID));
        if (existing) return existing;
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await idb(db, "readwrite", (s) => s.put(key, KEY_ID));
        return key;
    }).finally(() => (createPromise = null));
    return createPromise;
}

/** 鍵を読み出す。無ければ create のときだけ作る（作らないときは null） */
async function getKey({ create }) {
    const key = await loadKey();
    if (key || !create) return key ?? null;
    return createKey();
}

const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(text) {
    const key = await getKey({ create: true });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    return { v: 1, iv: toBase64(iv), data: toBase64(data) };
}

async function decrypt(enc) {
    const key = await getKey({ create: false });
    if (!key) return null;
    try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(enc.iv) }, key, fromBase64(enc.data));
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}

/** 保存されたログイン情報があるか（中身は復号しない） */
export function hasStoredLoginInfo(info) {
    return Boolean(info?.userId && (info.encPassword || info.password));
}

/**
 * ログイン情報を保存する。password が空なら、保存済みのパスワードをそのまま使う（ID だけ変えるとき）
 */
export async function saveLoginInfo({ userId, password }) {
    userId = String(userId ?? "").trim();
    if (!userId) throw new Error(globalThis.WMP.t("ID とパスワードを入力してください"));
    const { [LOGIN_INFO_KEY]: current } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    let encPassword;
    if (password) {
        encPassword = await encrypt(password);
    } else if (current?.encPassword && (await decrypt(current.encPassword)) !== null) {
        encPassword = current.encPassword;
    } else if (current?.password) {
        encPassword = await encrypt(current.password);
    } else {
        throw new Error(globalThis.WMP.t("ID とパスワードを入力してください"));
    }
    await chrome.storage.local.set({ [LOGIN_INFO_KEY]: { userId, encPassword } });
}

/**
 * 保存されたログイン情報を復号して返す。
 * @returns {Promise<{ userId, password? , lost? } | null>}
 *   ID も無ければ null。パスワードが無ければ password なし。
 *   保存されていたが復号できなかった（鍵が消えた など）ときは lost: true（入れ直すまで続く）
 */
export async function readLoginInfo() {
    const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    if (!info?.userId) return null;
    if (!hasStoredLoginInfo(info)) return { userId: info.userId, lost: Boolean(info.passwordLost) };
    if (info.password) {
        // 以前の版で暗号化せずに保存したもの。置き換えに失敗しても、読めたパスワードで続ける
        await migratePlainPassword().catch((e) => console.error("migratePlainPassword failed", e));
        return { userId: info.userId, password: info.password };
    }
    const password = await decrypt(info.encPassword);
    if (password) return { userId: info.userId, password };
    // 元に戻せないパスワードを持ち続けても使えないので捨てる（ID は入れ直しやすいように残す）。
    // これで「保存済み」の表示や自動ログインのルールも、保存されていない状態にそろう
    const { [LOGIN_INFO_KEY]: latest } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    // 確かめている間に新しいパスワードが保存されていたら、そちらは消さない
    if (latest?.encPassword?.data === info.encPassword.data) {
        await chrome.storage.local.set({ [LOGIN_INFO_KEY]: { userId: info.userId, passwordLost: true } });
    }
    return { userId: info.userId, lost: true };
}

/** 設定画面・ポップアップ用: パスワードは返さず、ID と、使えるパスワードが保存済みかどうかだけ返す */
export async function getLoginInfoSummary() {
    const info = await readLoginInfo();
    return { userId: info?.userId ?? "", hasPassword: Boolean(info?.password), passwordLost: Boolean(info?.lost) };
}

let migratePromise = null;

/** 以前の版で暗号化せずに保存したパスワードがあれば、暗号化した形に置き換える（同時に呼ばれたら1回にまとめる） */
export function migratePlainPassword() {
    migratePromise ??= (async () => {
        const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
        if (info?.userId && info.password) await saveLoginInfo(info);
    })().finally(() => (migratePromise = null));
    return migratePromise;
}
