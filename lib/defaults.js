// 設定のデフォルト値と、設定の読み書き。
// 拡張機能のすべての場所（バックグラウンド・ポップアップ・設定画面・コンテンツスクリプト）から使うため、
// モジュールではなく globalThis.WMP に公開するクラシックスクリプトとして書いている。
(() => {
    const DAY = 24 * 60 * 60 * 1000;

    const DEFAULT_SETTINGS = {
        // ===== 外観 =====
        /** "classic"（旧デザイン: 今までの Moodle） | "new"（新デザイン） */
        design: "classic",
        /** Moodle の上部ヘッダーに旧デザイン・新デザインの切り替えボタンを表示する */
        designToggleInHeader: true,
        /** "off" | "on" | "auto"（Moodle のページ） */
        darkMode: "off",
        /** "theme"（専用テーマ） | "invert"（色反転） */
        darkModeMethod: "theme",
        /** Moodle の上部ヘッダーにダークモードの切り替えボタンを表示する */
        darkModeToggleInHeader: true,
        /** 拡張機能自身の画面のテーマ "auto" | "light" | "dark" */
        uiTheme: "auto",

        // ===== 自動ログイン =====
        autoLoginEnabled: false,

        // ===== 時間割（コース概要） =====
        courseOverviewEnabled: true,
        showSaturday: true,
        showSunday: false,
        showPeriodTimes: true,
        /** 時間割に常に表示する時限（これより後に科目があればそこまで広げる） */
        timetableMaxPeriod: 6,
        showClassroom: true,
        showAssignmentCountOnTimetable: true,
        hideCoursesBeforeEnrollment: true,
        /** { [courseId]: [{year, term, day, from, to, classroom}] } */
        timetable: {},
        /** { [courseId]: "表示名" } */
        courseNameOverrides: {},
        /** { [courseId]: "#rrggbb" } */
        courseColors: {},
        /** { [courseId]: "メモ" } */
        courseNotes: {},
        /** { [courseId]: syllabusKey } */
        courseSyllabusKeys: {},
        /** { [courseId]: "face_to_face" | "realtime_streaming" | "on_demand" } */
        courseDeliveryMethods: {},
        /** 時間割で非表示にした科目 ID */
        timetableHiddenCourses: [],
        /** { year, term } 最後に選んだ年度・学期 */
        selectedYearTerm: null,

        // ===== 課題一覧（タイムライン） =====
        timelineEnabled: true,
        timelineBackwardDays: 14,
        timelineForwardDays: 365,
        timelineHiddenEventIds: [],
        timelineHiddenCourses: [],
        timelineHiddenModuleNames: [],
        /** 先生が決めた「完了予定日」（提出期限ではない目安の日）を一覧・件数・通知に出さない */
        timelineHideExpectCompletion: true,
        /** GitHub の最新リリースを1日1回確かめ、新しいバージョンがあれば知らせる（ストアから入れた場合は使わない） */
        updateCheckEnabled: true,
        /** 日付の区切りをずらす（時間単位）。例: 2 にすると 1:59 締切の課題は前日扱い */
        timelineDateBorderOffsetHours: 0,
        timelineShowInDashboard: true,
        badgeEnabled: true,
        badgeDeadlineRangeDays: 3,
        notificationsEnabled: false,
        notificationHoursBefore: 24,

        // ===== 小テスト =====
        quizRemainingTimeEnabled: true,
        remindUnansweredEnabled: true,
        remindUnansweredOnlySequential: true,

        // ===== スタイル =====
        reduceCourseContentPadding: false,
        removeFloatingActionButtons: false,
        removeNotificationBadge: false,
        modernLook: true,

        // ===== その他 =====
        autoSessionExtension: true,
        checkSessionBeforeSubmit: true,
        checkNotesOnSubmitting: true,
        wordCounterEnabled: true,
        assignmentFilenameEnabled: false,
        assignmentFilenameTemplate: "1X999999_早稲田太郎_{course}_{assignment}{extension}",
        /** { [courseId]: "テンプレート" } */
        assignmentFilenameTemplateCourse: {},
        viewInBrowser: false,
        removeLoadingVideo: true,
        /** 授業動画のファイル・配信ストリームの URL を一覧にしてコピーできるようにする */
        videoUrlCopy: true,
        fixPortalLink: true,
        fixSyllabusLink: true,
        blockTracking: false,
        fasterBackAndForward: true,
    };

    /** バックアップに含めないキー（ログイン情報は別のストレージキーに保存している） */
    const SETTINGS_KEY = "settings";
    const LOGIN_INFO_KEY = "loginInfo";

    async function getSettings() {
        const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
        return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    }

    async function setSettings(patch) {
        const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
        const next = { ...(stored ?? {}), ...patch };
        await chrome.storage.local.set({ [SETTINGS_KEY]: next });
        return { ...DEFAULT_SETTINGS, ...next };
    }

    /** 設定が変わったときに (新しい設定, 変わったキーの配列) で呼ばれる */
    function onSettingsChanged(callback) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || !changes[SETTINGS_KEY]) return;
            const oldValue = changes[SETTINGS_KEY].oldValue ?? {};
            const newValue = changes[SETTINGS_KEY].newValue ?? {};
            const changedKeys = Object.keys(DEFAULT_SETTINGS).filter(
                (k) => JSON.stringify(oldValue[k]) !== JSON.stringify(newValue[k])
            );
            if (changedKeys.length > 0) callback({ ...DEFAULT_SETTINGS, ...newValue }, changedKeys);
        });
    }

    globalThis.WMP = {
        DAY,
        DEFAULT_SETTINGS,
        SETTINGS_KEY,
        LOGIN_INFO_KEY,
        getSettings,
        setSettings,
        onSettingsChanged,
        MOODLE_ORIGIN: "https://wsdmoodle.waseda.jp",
        SAML_LOGIN_URL:
            "https://wsdmoodle.waseda.jp/auth/saml2/login.php?wants=https%3A%2F%2Fwsdmoodle.waseda.jp%2F&idp=fcc52c5d2e034b1803ea1932ae2678b0&passive=off",
    };
})();
