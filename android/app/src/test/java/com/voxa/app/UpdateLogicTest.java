package com.voxa.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class UpdateLogicTest {
    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static String json(String name, int code, String apk, String sha) {
        return "{\"app\":\"Voxa\",\"versionName\":\"" + name + "\",\"versionCode\":" + code
                + ",\"apk\":\"" + apk + "\",\"sha256\":\"" + sha + "\",\"minSdk\":26,\"notes\":\"Yeni ozellikler\\nSatir 2\"}";
    }

    @Test
    public void versiyonKarsilastirma() {
        assertEquals(0, UpdateLogic.compareVersions("1.0.7", "1.0.7"));
        assertEquals(-1, UpdateLogic.compareVersions("1.0.7", "1.0.8"));
        assertEquals(1, UpdateLogic.compareVersions("1.1.0", "1.0.99"));
        assertEquals(1, UpdateLogic.compareVersions("1.0.10", "1.0.9"));
        assertEquals(-1, UpdateLogic.compareVersions("1.0", "1.0.1"));
    }

    @Test
    public void adresIzinleri() {
        assertTrue(UpdateLogic.isAllowedUrl("https://github.com/bburakk65/Voxa/releases/latest/download/version.json"));
        assertTrue(UpdateLogic.isAllowedUrl("https://objects.githubusercontent.com/abc"));
        assertTrue(UpdateLogic.isAllowedUrl("https://release-assets.githubusercontent.com/abc"));
        assertTrue(UpdateLogic.isAllowedUrl("https://api.github.com/repos/x/y"));
        assertFalse(UpdateLogic.isAllowedUrl("http://github.com/x"));
        assertFalse(UpdateLogic.isAllowedUrl("https://evil.com/github.com"));
        assertFalse(UpdateLogic.isAllowedUrl("https://github.com.evil.com/x"));
        assertFalse(UpdateLogic.isAllowedUrl("https://evilgithubusercontent.com/x"));
        assertFalse(UpdateLogic.isAllowedUrl("https://user@github.com/x"));
        assertFalse(UpdateLogic.isAllowedUrl("https://github.com:8443/x"));
        assertFalse(UpdateLogic.isAllowedUrl("ftp://github.com/x"));
        assertFalse(UpdateLogic.isAllowedUrl(null));
        assertFalse(UpdateLogic.isAllowedUrl("not a url"));
    }

    @Test
    public void gecerliSurumBilgisi() throws Exception {
        UpdateLogic.VersionInfo v = UpdateLogic.parseVersionInfo(json("1.0.7", 7, "Voxa-v1.0.7.apk", SHA));
        assertEquals("1.0.7", v.versionName);
        assertEquals(7, v.versionCode);
        assertEquals("Voxa-v1.0.7.apk", v.apk);
        assertEquals(SHA, v.sha256);
        assertEquals(26, v.minSdk);
        assertTrue(v.notes.contains("Satir 2"));
        assertTrue(UpdateLogic.isNewer(v, 6));
        assertFalse(UpdateLogic.isNewer(v, 7));
        assertFalse(UpdateLogic.isNewer(v, 8));
    }

    private static void reddedilmeli(String j) {
        try {
            UpdateLogic.parseVersionInfo(j);
            fail("Kabul edilmemeliydi: " + j);
        } catch (Exception expected) {
            assertNotNull(expected.getMessage());
        }
    }

    @Test
    public void gecersizBilgilerReddedilir() {
        reddedilmeli("{}");
        reddedilmeli("[]");
        reddedilmeli("bozuk");
        reddedilmeli("{\"app\":\"Baska\",\"versionName\":\"1.0.1\",\"versionCode\":1,\"apk\":\"Voxa-v1.0.1.apk\",\"sha256\":\"" + SHA + "\"}");
        reddedilmeli(json("1.0", 7, "Voxa-v1.0.apk", SHA));
        reddedilmeli(json("1.0.7", 0, "Voxa-v1.0.7.apk", SHA));
        reddedilmeli(json("1.0.7", 7, "Baska.apk", SHA));
        reddedilmeli(json("1.0.7", 7, "../Voxa-v1.0.7.apk", SHA));
        reddedilmeli(json("1.0.7", 7, "Voxa-v1.0.7.apk", "kisa"));
        reddedilmeli(json("1.0.7", 7, "Voxa-v1.0.7.apk", SHA + "00"));
    }

    @Test
    public void indirmeAdresiSurumdenUretilir() throws Exception {
        UpdateLogic.VersionInfo v = UpdateLogic.parseVersionInfo(json("1.2.3", 9, "Voxa-v1.2.3.apk", SHA));
        assertEquals("https://github.com/bburakk65/Voxa/releases/download/v1.2.3/Voxa-v1.2.3.apk",
                UpdateLogic.apkUrl("bburakk65/Voxa", v));
        try {
            UpdateLogic.apkUrl("../kotu", v);
            fail("Geçersiz depo adı kabul edildi");
        } catch (IllegalArgumentException expected) { }
    }

    @Test
    public void ozetKarsilastirma() {
        assertTrue(UpdateLogic.hashesEqual(SHA, SHA.toUpperCase()));
        assertFalse(UpdateLogic.hashesEqual(SHA, SHA.replace('a', 'b')));
        assertFalse(UpdateLogic.hashesEqual(SHA, null));
        assertEquals("00ff10", UpdateLogic.toHex(new byte[]{0, (byte) 255, 16}));
    }

    @Test
    public void jsonOkuyucu() throws Exception {
        Object o = MiniJson.parse("{\"a\":[1,2,{\"b\":null}],\"c\":\"\\u00e7\\n\",\"d\":true,\"e\":1.5}");
        assertNotNull(o);
        try {
            MiniJson.parse("{\"a\":1} fazlalik");
            fail();
        } catch (Exception expected) { }
        try {
            MiniJson.parse("{\"a\":");
            fail();
        } catch (Exception expected) { }
    }
}
