package com.voxa.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Yalnızca güvenilir (https + GitHub) adreslerden indirir; yönlendirmeleri tek tek denetler. */
final class HttpFetch {
    interface Progress { void onProgress(long done, long total); }

    private HttpFetch() {}

    private static HttpURLConnection open(String url) throws IOException {
        String cur = url;
        for (int hop = 0; hop < 6; hop++) {
            if (!UpdateLogic.isAllowedUrl(cur)) throw new IOException("Güvenilmeyen adres reddedildi");
            HttpURLConnection c = (HttpURLConnection) new URL(cur).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "VoxaAndroid");
            c.setRequestProperty("Accept", "*/*");
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Yönlendirme adresi yok");
                cur = new URL(new URL(cur), loc).toString();
                continue;
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("Sunucu cevabı: " + code);
            }
            return c;
        }
        throw new IOException("Çok fazla yönlendirme");
    }

    static String getText(String url, int maxBytes) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > maxBytes) throw new IOException("Cevap çok büyük");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    static void download(String url, File dest, long maxBytes, Progress p) throws IOException {
        File part = new File(dest.getPath() + ".part");
        HttpURLConnection c = open(url);
        try {
            long total = c.getContentLengthLong();
            if (total > maxBytes) throw new IOException("Dosya beklenenden büyük");
            long done = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[65536];
                int n;
                long lastTick = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    if (done > maxBytes) throw new IOException("Dosya beklenenden büyük");
                    long now = System.currentTimeMillis();
                    if (p != null && now - lastTick > 150) { lastTick = now; p.onProgress(done, total); }
                }
            }
            if (p != null) p.onProgress(done, total);
            if (dest.exists() && !dest.delete()) throw new IOException("Eski dosya silinemedi");
            if (!part.renameTo(dest)) throw new IOException("Dosya kaydedilemedi");
        } catch (IOException e) {
            part.delete();
            throw e;
        } finally {
            c.disconnect();
        }
    }
}
