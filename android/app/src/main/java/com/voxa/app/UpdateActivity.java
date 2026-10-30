package com.voxa.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.File;
import java.util.Locale;

public class UpdateActivity extends Activity {
    public static final String ACTION_RESULT = "com.voxa.app.INSTALL_UI_RESULT";

    private TextView ver;
    private TextView status;
    private TextView notes;
    private TextView pct;
    private ProgressBar bar;
    private Button btnCheck;
    private Button btnUpdate;
    private UpdateLogic.VersionInfo latest;
    private boolean busy = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver resultReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int st = i.getIntExtra("status", -1);
            String msg = i.getStringExtra("message");
            setBusy(false);
            bar.setVisibility(View.GONE);
            pct.setVisibility(View.GONE);
            status.setText("Kurulum tamamlanamadı: " + friendly(st, msg));
            btnUpdate.setText("Yeniden dene");
            btnUpdate.setVisibility(View.VISIBLE);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_update);
        ver = findViewById(R.id.ver);
        status = findViewById(R.id.status);
        notes = findViewById(R.id.notes);
        pct = findViewById(R.id.pct);
        bar = findViewById(R.id.bar);
        btnCheck = findViewById(R.id.btn_check);
        btnUpdate = findViewById(R.id.btn_update);
        Button btnClose = findViewById(R.id.btn_close);

        ver.setText("Yüklü sürüm: v" + BuildConfig.VERSION_NAME + " (kod " + BuildConfig.VERSION_CODE + ")");
        btnCheck.setOnClickListener(v -> checkNow());
        btnUpdate.setOnClickListener(v -> startUpdate());
        btnClose.setOnClickListener(v -> finish());

        IntentFilter f = new IntentFilter(ACTION_RESULT);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(resultReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(resultReceiver, f);
        }

        cleanOldDownloads();
        checkNow();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(resultReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    private void cleanOldDownloads() {
        File dir = new File(getCacheDir(), "update");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
    }

    private void setBusy(boolean b) {
        busy = b;
        btnCheck.setEnabled(!b);
        btnUpdate.setEnabled(!b);
    }

    private boolean dead() {
        return isFinishing() || (Build.VERSION.SDK_INT >= 17 && isDestroyed());
    }

    private void checkNow() {
        if (busy) return;
        setBusy(true);
        status.setText("Güncelleme kontrol ediliyor…");
        notes.setText("");
        btnUpdate.setVisibility(View.GONE);
        new Thread(() -> {
            UpdateLogic.VersionInfo v = null;
            Exception err = null;
            try {
                v = UpdateClient.fetchLatest();
            } catch (Exception e) {
                err = e;
            }
            final UpdateLogic.VersionInfo fv = v;
            final Exception fe = err;
            ui.post(() -> onChecked(fv, fe));
        }).start();
    }

    private void onChecked(UpdateLogic.VersionInfo v, Exception e) {
        if (dead()) return;
        setBusy(false);
        if (e != null || v == null) {
            status.setText("Güncelleme sunucusuna ulaşılamadı ya da henüz yayımlanmış sürüm yok. İnternetini kontrol edip yeniden dene.");
            btnCheck.setText("Yeniden dene");
            return;
        }
        btnCheck.setText("Güncellemeleri denetle");
        latest = v;
        if (!UpdateLogic.isNewer(v, BuildConfig.VERSION_CODE)) {
            status.setText("Voxa güncel ✓ (v" + BuildConfig.VERSION_NAME + ")");
            notes.setText("");
            return;
        }
        if (v.minSdk > Build.VERSION.SDK_INT) {
            status.setText("Yeni sürüm (v" + v.versionName + ") var ama bu telefonun Android sürümüyle uyumlu değil.");
            return;
        }
        status.setText("Yeni sürüm var: v" + v.versionName);
        notes.setText(v.notes.isEmpty() ? "Değişiklik notu yok." : v.notes);
        btnUpdate.setText("Güncelle");
        btnUpdate.setVisibility(View.VISIBLE);
    }

    private void startUpdate() {
        if (busy || latest == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                    .setTitle("Bir kez izin gerekli")
                    .setMessage("Voxa'nın güncellemeyi kurabilmesi için Android ayarlarında \"Bu kaynaktan yüklemeye izin ver\" seçeneğini açman gerekiyor. Ayarlar açılacak: izni açıp geri dön, sonra Güncelle'ye tekrar bas.")
                    .setPositiveButton("Ayarları aç", (d, w) -> startActivity(new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))))
                    .setNegativeButton("Vazgeç", null)
                    .show();
            return;
        }
        setBusy(true);
        final UpdateLogic.VersionInfo v = latest;
        status.setText("İndiriliyor…");
        bar.setIndeterminate(true);
        bar.setVisibility(View.VISIBLE);
        pct.setVisibility(View.VISIBLE);
        pct.setText("");
        new Thread(() -> {
            File dir = new File(getCacheDir(), "update");
            dir.mkdirs();
            File apk = new File(dir, v.apk);
            try {
                HttpFetch.download(UpdateClient.apkUrl(v), apk, 150L * 1024 * 1024,
                        (done, total) -> ui.post(() -> showProgress(done, total)));
                ui.post(() -> { if (!dead()) status.setText("Dosya doğrulanıyor…"); });
                String err = ApkVerifier.verify(UpdateActivity.this, apk, v);
                if (err != null) {
                    apk.delete();
                    ui.post(() -> fail(err));
                    return;
                }
                ui.post(() -> { if (!dead()) status.setText("Android kurulum ekranı açılıyor…"); });
                ApkInstaller.install(UpdateActivity.this, apk);
            } catch (Exception e) {
                apk.delete();
                final String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                ui.post(() -> fail("İndirme ya da kurulum başarısız: " + m));
            }
        }).start();
    }

    private void showProgress(long done, long total) {
        if (dead()) return;
        if (total > 0) {
            bar.setIndeterminate(false);
            bar.setProgress((int) (done * 100 / total));
            pct.setText(String.format(Locale.US, "%%%d  (%.1f / %.1f MB)", done * 100 / total, done / 1048576.0, total / 1048576.0));
        } else {
            pct.setText(String.format(Locale.US, "%.1f MB", done / 1048576.0));
        }
    }

    private void fail(String msg) {
        if (dead()) return;
        setBusy(false);
        bar.setVisibility(View.GONE);
        pct.setVisibility(View.GONE);
        status.setText(msg);
        btnUpdate.setText("Yeniden dene");
        btnUpdate.setVisibility(View.VISIBLE);
    }

    private static String friendly(int st, String msg) {
        switch (st) {
            case PackageInstaller.STATUS_FAILURE_ABORTED: return "kurulum iptal edildi.";
            case PackageInstaller.STATUS_FAILURE_BLOCKED: return "kurulum engellendi (telefon ayarları ya da güvenlik uygulaması).";
            case PackageInstaller.STATUS_FAILURE_CONFLICT: return "yüklü sürümle çakışma var.";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: return "bu sürüm telefonunla uyumlu değil.";
            case PackageInstaller.STATUS_FAILURE_INVALID: return "paket geçersiz.";
            case PackageInstaller.STATUS_FAILURE_STORAGE: return "telefonda yeterli alan yok.";
            default: return msg == null ? "bilinmeyen hata." : msg;
        }
    }
}
