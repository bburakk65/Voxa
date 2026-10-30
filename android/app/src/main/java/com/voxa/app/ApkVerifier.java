package com.voxa.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/** İndirilen APK'yı kurmadan önce doğrular. */
final class ApkVerifier {
    private ApkVerifier() {}

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        return UpdateLogic.toHex(md.digest());
    }

    /** null = her şey tamam, aksi halde Türkçe hata metni. */
    static String verify(Context ctx, File apk, UpdateLogic.VersionInfo v) {
        try {
            String actual = sha256(apk);
            if (!UpdateLogic.hashesEqual(actual, v.sha256)) {
                return "Dosya bozuk ya da değiştirilmiş (SHA-256 uyuşmuyor).";
            }
            PackageManager pm = ctx.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
            if (info == null) return "APK dosyası okunamadı.";
            if (!ctx.getPackageName().equals(info.packageName)) return "Paket kimliği farklı, kurulum durduruldu.";
            long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            if (code != v.versionCode) return "Sürüm numarası bilgiyle uyuşmuyor.";
            if (code <= BuildConfig.VERSION_CODE) return "Bu sürüm zaten yüklü ya da daha eski.";
            PackageInfo mine = pm.getPackageInfo(ctx.getPackageName(), flags);
            Set<String> a = signers(info);
            Set<String> b = signers(mine);
            if (a.isEmpty() || !a.equals(b)) return "Dosyanın imzası yüklü Voxa ile aynı değil, kurulum durduruldu.";
            return null;
        } catch (Exception e) {
            return "Doğrulama hatası: " + e.getMessage();
        }
    }

    private static Set<String> signers(PackageInfo info) throws Exception {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= 28) {
            SigningInfo si = info.signingInfo;
            if (si != null) sigs = si.getApkContentsSigners();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            out.add(UpdateLogic.toHex(md.digest(s.toByteArray())));
        }
        return out;
    }
}
