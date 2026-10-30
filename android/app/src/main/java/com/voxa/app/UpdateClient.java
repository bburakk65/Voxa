package com.voxa.app;

final class UpdateClient {
    private UpdateClient() {}

    static final String VERSION_URL =
            "https://github.com/" + BuildConfig.UPDATE_REPO + "/releases/latest/download/version.json";

    /** Yayımlanmış en son kararlı sürümün bilgisini getirir (yayın yoksa hata verir). */
    static UpdateLogic.VersionInfo fetchLatest() throws Exception {
        String json = HttpFetch.getText(VERSION_URL, 64 * 1024);
        return UpdateLogic.parseVersionInfo(json);
    }

    static String apkUrl(UpdateLogic.VersionInfo v) {
        return UpdateLogic.apkUrl(BuildConfig.UPDATE_REPO, v);
    }
}
