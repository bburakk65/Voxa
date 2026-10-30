package com.voxa.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_PERMS = 41;
    private static final int REQ_FILE = 42;

    private WebView web;
    private View offline;
    private TextView offlineText;
    private ProgressBar progress;
    private PermissionRequest pendingPerm;
    private ValueCallback<Uri[]> fileCb;
    private String siteHost;
    private boolean failed = false;
    private long lastBack = 0;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback netCb;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
        siteHost = Uri.parse(BuildConfig.SITE_URL).getHost();
        web = findViewById(R.id.web);
        offline = findViewById(R.id.offline);
        offlineText = findViewById(R.id.offline_text);
        progress = findViewById(R.id.progress);
        Button retry = findViewById(R.id.retry);
        retry.setOnClickListener(v -> reloadPage());

        setupWebView();
        if (b != null) {
            web.restoreState(b);
        } else {
            web.loadUrl(startUrl(getIntent()));
        }

        cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        netCb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                runOnUiThread(() -> { if (offline.getVisibility() == View.VISIBLE) reloadPage(); });
            }
        };
        try { cm.registerDefaultNetworkCallback(netCb); } catch (Exception ignored) { netCb = null; }

        maybeCheckUpdates();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getData() != null) web.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (cm != null && netCb != null) {
            try { cm.unregisterNetworkCallback(netCb); } catch (Exception ignored) { }
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }

    private String startUrl(Intent i) {
        if (i != null && i.getData() != null) {
            Uri u = i.getData();
            if (isSite(u)) return u.toString();
        }
        return BuildConfig.SITE_URL;
    }

    private boolean isSite(Uri u) {
        return u != null && "https".equals(u.getScheme()) && siteHost != null && siteHost.equalsIgnoreCase(u.getHost());
    }

    private void openExternal(Uri u) {
        String sc = u.getScheme();
        if (!"http".equals(sc) && !"https".equals(sc) && !"mailto".equals(sc) && !"tel".equals(sc)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception e) {
            Toast.makeText(this, "Bu bağlantı açılamadı", Toast.LENGTH_SHORT).show();
        }
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " VoxaAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setBackgroundColor(0xFF1E1F22);
        web.addJavascriptInterface(new Bridge(), "VoxaApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                Uri u = Uri.parse(url);
                if (!isSite(u)) { openExternal(u); return; }
                try {
                    DownloadManager.Request r = new DownloadManager.Request(u);
                    String name = URLUtil.guessFileName(url, cd, mime);
                    r.setTitle(name);
                    r.setMimeType(mime);
                    r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                    Toast.makeText(MainActivity.this, "İndirme başladı", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Bu indirme desteklenmiyor", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void showOffline(String why) {
        offlineText.setText(why == null || why.isEmpty()
                ? getString(R.string.offline_text)
                : getString(R.string.offline_text) + "\n\n(" + why + ")");
        offline.setVisibility(View.VISIBLE);
    }

    private void reloadPage() {
        offline.setVisibility(View.GONE);
        failed = false;
        String u = web.getUrl();
        if (u == null || u.startsWith("data:") || u.startsWith("about:")) {
            web.loadUrl(BuildConfig.SITE_URL);
        } else {
            web.reload();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (isSite(u)) return false;
            openExternal(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, android.graphics.Bitmap fav) {
            failed = false;
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            progress.setVisibility(View.GONE);
            if (!failed) offline.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) {
                failed = true;
                showOffline(String.valueOf(e.getDescription()));
            }
        }

        @Override
        public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
            if (r.isForMainFrame() && resp.getStatusCode() >= 500) {
                failed = true;
                showOffline("Sunucu şu an yanıt vermiyor (" + resp.getStatusCode() + ")");
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            runOnUiThread(() -> recreate());
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView v, int p) {
            progress.setProgress(p);
            if (p >= 100) progress.setVisibility(View.GONE);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest req) {
            runOnUiThread(() -> handlePermission(req));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest req) {
            if (pendingPerm == req) pendingPerm = null;
        }

        @Override
        public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (Exception e) {
                fileCb = null;
                return false;
            }
            return true;
        }
    }

    private void handlePermission(PermissionRequest req) {
        if (!isSite(req.getOrigin())) { req.deny(); return; }
        List<String> missing = new ArrayList<>();
        boolean any = false;
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                any = true;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                    missing.add(Manifest.permission.RECORD_AUDIO);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                any = true;
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                    missing.add(Manifest.permission.CAMERA);
            }
        }
        if (!any) { req.deny(); return; }
        if (missing.isEmpty()) {
            req.grant(allowedResources(req));
            return;
        }
        if (pendingPerm != null) pendingPerm.deny();
        pendingPerm = req;
        requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
    }

    private String[] allowedResources(PermissionRequest req) {
        List<String> ok = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ok.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) ok.add(r);
        }
        return ok.toArray(new String[0]);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_PERMS || pendingPerm == null) return;
        PermissionRequest req = pendingPerm;
        pendingPerm = null;
        String[] ok = allowedResources(req);
        if (ok.length > 0) req.grant(ok); else req.deny();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) { finish(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) {
            super.onBackPressed();
        } else {
            lastBack = now;
            Toast.makeText(this, "Çıkmak için tekrar geri tuşuna bas", Toast.LENGTH_SHORT).show();
        }
    }

    /** Siteden çağrılabilen küçük köprü: yalnızca sürüm bilgisi ve güncelleme ekranı. */
    private class Bridge {
        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void openUpdates() {
            runOnUiThread(() -> {
                String u = web.getUrl();
                if (u != null && isSite(Uri.parse(u))) startActivity(new Intent(MainActivity.this, UpdateActivity.class));
            });
        }
    }

    private void maybeCheckUpdates() {
        final SharedPreferences sp = getSharedPreferences("voxa", MODE_PRIVATE);
        final long now = System.currentTimeMillis();
        if (now < sp.getLong("snooze", 0) || now - sp.getLong("lastCheck", 0) < 12L * 3600 * 1000) return;
        new Thread(() -> {
            try {
                final UpdateLogic.VersionInfo v = UpdateClient.fetchLatest();
                sp.edit().putLong("lastCheck", now).apply();
                if (UpdateLogic.isNewer(v, BuildConfig.VERSION_CODE) && v.minSdk <= Build.VERSION.SDK_INT) {
                    runOnUiThread(() -> showUpdateDialog(v, sp));
                }
            } catch (Exception ignored) {
                // Sunucuya ulaşılamazsa uygulama normal çalışmaya devam eder.
            }
        }).start();
    }

    private void showUpdateDialog(UpdateLogic.VersionInfo v, final SharedPreferences sp) {
        if (isFinishing()) return;
        String notes = v.notes.length() > 600 ? v.notes.substring(0, 600) + "…" : v.notes;
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Yeni sürüm: v" + v.versionName)
                .setMessage(notes.isEmpty() ? "Voxa için yeni bir sürüm var." : notes)
                .setPositiveButton("Güncelle", (d, w) -> startActivity(new Intent(this, UpdateActivity.class)))
                .setNegativeButton("Daha sonra", (d, w) ->
                        sp.edit().putLong("snooze", System.currentTimeMillis() + 24L * 3600 * 1000).apply())
                .show();
    }
}
