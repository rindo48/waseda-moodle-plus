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

let keyPromise = null;

/** 鍵を読み出す。無ければ create のときだけ作る（作らないときは null） */
function getKey({ create }) {
    if (!keyPromise) {
        keyPromise = (async () => {
            const db = await openDb();
            try {
                const stored = await idb(db, "readonly", (s) => s.get(KEY_ID));
                if (stored) return stored;
                if (!create) return null;
                const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
                await idb(db, "readwrite", (s) => s.put(key, KEY_ID));
                return key;
            } finally {
                db.close();
            }
        })().finally(() => (keyPromise = null));
    }
    return keyPromise;
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
    } else if (current?.encPassword) {
        encPassword = current.encPassword;
    } else if (current?.password) {
        encPassword = await encrypt(current.password);
    } else {
        throw new Error(globalThis.WMP.t("ID とパスワードを入力してください"));
    }
    await chrome.storage.local.set({ [LOGIN_INFO_KEY]: { userId, encPassword } });
}

/** 保存されたログイン情報を復号して返す。無い・読めないときは null */
export async function readLoginInfo() {
    const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    if (!hasStoredLoginInfo(info)) return null;
    if (info.password) {
        // 以前の版で暗号化せずに保存したもの。読むついでに暗号化した形に置き換える
        await saveLoginInfo(info);
        return { userId: info.userId, password: info.password };
    }
    const password = await decrypt(info.encPassword);
    return password ? { userId: info.userId, password } : null;
}

/** 設定画面用: パスワードは返さず、ID と保存済みかどうかだけ返す */
export async function getLoginInfoSummary() {
    const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    return { userId: info?.userId ?? "", hasPassword: hasStoredLoginInfo(info) };
}

/** 以前の版で暗号化せずに保存したパスワードがあれば、暗号化した形に置き換える */
export async function migratePlainPassword() {
    const { [LOGIN_INFO_KEY]: info } = await chrome.storage.local.get(LOGIN_INFO_KEY);
    if (info?.userId && info.password) await saveLoginInfo(info);
}
