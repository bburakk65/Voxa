package com.voxa.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Güncelleme kuralları. Android'e bağlı değil; birim testleriyle doğrulanır. */
public final class UpdateLogic {
    private UpdateLogic() {}

    public static final class VersionInfo {
        public final String versionName;
        public final int versionCode;
        public final String apk;
        public final String sha256;
        public final String notes;
        public final int minSdk;

        VersionInfo(String versionName, int versionCode, String apk, String sha256, String notes, int minSdk) {
            this.versionName = versionName;
            this.versionCode = versionCode;
            this.apk = apk;
            this.sha256 = sha256;
            this.notes = notes;
            this.minSdk = minSdk;
        }
    }

    private static final Pattern VERSION = Pattern.compile("^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,9}$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern REPO = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$");

    /** Yalnızca https ve GitHub adreslerine izin verir. */
    public static boolean isAllowedUrl(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            if (!"https".equalsIgnoreCase(u.getScheme())) return false;
            if (u.getUserInfo() != null) return false;
            int port = u.getPort();
            if (port != -1 && port != 443) return false;
            String h = u.getHost();
            if (h == null) return false;
            h = h.toLowerCase(Locale.ROOT);
            return h.equals("github.com") || h.equals("api.github.com") || h.endsWith(".githubusercontent.com");
        } catch (Exception e) {
            return false;
        }
    }

    public static int compareVersions(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            long p = i < x.length ? num(x[i]) : 0;
            long q = i < y.length ? num(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }

    private static long num(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0; }
    }

    public static boolean isNewer(VersionInfo v, int installedCode) {
        return v != null && v.versionCode > installedCode;
    }

    public static VersionInfo parseVersionInfo(String json) throws Exception {
        Object root = MiniJson.parse(json);
        if (!(root instanceof Map)) throw new Exception("Sürüm bilgisi biçimi geçersiz");
        Map<?, ?> m = (Map<?, ?>) root;
        if (!"Voxa".equals(m.get("app"))) throw new Exception("Bu bilgi Voxa'ya ait değil");
        String name = str(m, "versionName");
        if (name == null || !VERSION.matcher(name).matches()) throw new Exception("Sürüm adı geçersiz");
        Integer code = intOf(m.get("versionCode"));
        if (code == null || code < 1) throw new Exception("Sürüm numarası geçersiz");
        String apk = str(m, "apk");
        if (apk == null || !apk.equals("Voxa-v" + name + ".apk")) throw new Exception("APK adı geçersiz");
        String sha = str(m, "sha256");
        if (sha == null) throw new Exception("SHA-256 bilgisi yok");
        sha = sha.toLowerCase(Locale.ROOT);
        if (!SHA256.matcher(sha).matches()) throw new Exception("SHA-256 bilgisi geçersiz");
        String notes = str(m, "notes");
        if (notes == null) notes = "";
        if (notes.length() > 4000) notes = notes.substring(0, 4000);
        Integer minSdk = intOf(m.get("minSdk"));
        if (minSdk == null || minSdk < 1 || minSdk > 99) minSdk = 26;
        return new VersionInfo(name, code, apk, sha, notes, minSdk);
    }

    /** İndirme adresi sürüm bilgisinden değil, depo adı + doğrulanmış sürümden üretilir. */
    public static String apkUrl(String repo, VersionInfo v) {
        if (repo == null || !REPO.matcher(repo).matches()) throw new IllegalArgumentException("Depo adı geçersiz");
        return "https://github.com/" + repo + "/releases/download/v" + v.versionName + "/" + v.apk;
    }

    public static boolean hashesEqual(String a, String b) {
        if (a == null || b == null) return false;
        byte[] x = a.trim().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8);
        byte[] y = b.trim().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(x, y);
    }

    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }

    private static String str(Map<?, ?> m, String k) {
        Object o = m.get(k);
        return o instanceof String ? (String) o : null;
    }

    private static Integer intOf(Object o) {
        if (o instanceof Long) {
            long l = (Long) o;
            return (l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) ? Integer.valueOf((int) l) : null;
        }
        if (o instanceof Double) {
            double d = (Double) o;
            return (d == Math.rint(d) && Math.abs(d) < 2e9) ? Integer.valueOf((int) d) : null;
        }
        return null;
    }
}
