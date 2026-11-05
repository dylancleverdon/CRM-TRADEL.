package com.tradelink.crm;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native helpers for TradeLink CRM:
 *  - call():       one-tap phone calls through the phone's own SIM/number
 *  - http():       network requests without browser CORS limits (Google Apps Script sync, update checks)
 *  - installApk(): self-update by downloading the newest APK and opening the Android installer
 */
@CapacitorPlugin(
    name = "TradeLinkNative",
    permissions = { @Permission(strings = { Manifest.permission.CALL_PHONE }, alias = "call") }
)
public class TradeLinkNativePlugin extends Plugin {

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private File pendingApk = null;

    // ------------------------------------------------------------------ calls

    @PluginMethod
    public void call(PluginCall call) {
        if (call.getString("number") == null) {
            call.reject("number is required");
            return;
        }
        if (getPermissionState("call") != PermissionState.GRANTED) {
            requestPermissionForAlias("call", call, "callPermsCallback");
            return;
        }
        placeCall(call);
    }

    @PermissionCallback
    private void callPermsCallback(PluginCall call) {
        placeCall(call);
    }

    private void placeCall(PluginCall call) {
        String number = call.getString("number");
        boolean granted = getPermissionState("call") == PermissionState.GRANTED;
        Intent intent = new Intent(granted ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("method", granted ? "call" : "dial");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start call: " + e.getMessage());
        }
    }

    /** Keeps the screen on while "Desk phone mode" is listening for calls from the Mac. */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ------------------------------------------------------------------- http

    @PluginMethod
    public void http(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final String body = call.getString("body");
        executor.execute(() -> {
            try {
                String current = url;
                String m = method;
                String b = body;
                for (int i = 0; i < 8; i++) {
                    HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestMethod(m);
                    if ("POST".equals(m) && b != null) {
                        conn.setDoOutput(true);
                        conn.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(b.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                        current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                        if (code != 307 && code != 308) { m = "GET"; b = null; }
                        conn.disconnect();
                        continue;
                    }
                    InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    String text = is == null ? "" : readAll(is);
                    conn.disconnect();
                    JSObject ret = new JSObject();
                    ret.put("status", code);
                    ret.put("text", text);
                    call.resolve(ret);
                    return;
                }
                call.reject("Too many redirects");
            } catch (Exception e) {
                call.reject("Network error: " + e.getMessage());
            }
        });
    }

    private static String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return bos.toString("UTF-8");
    }

    // ---------------------------------------------------------------- updates

    @PluginMethod
    public void installApk(PluginCall call) {
        final String url = call.getString("url");
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "TradeLink-CRM.apk");
                if (apk.exists()) apk.delete();

                String current = url;
                HttpURLConnection conn = null;
                for (int i = 0; i < 8; i++) {
                    conn = (HttpURLConnection) new URL(current).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                        conn.disconnect();
                        continue;
                    }
                    if (code >= 400) throw new Exception("HTTP " + code);
                    break;
                }
                long total = conn.getContentLengthLong();
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    long got = 0;
                    int n;
                    long lastEmit = 0;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (total > 0 && now - lastEmit > 250) {
                            lastEmit = now;
                            JSObject p = new JSObject();
                            p.put("progress", (double) got / total);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                conn.disconnect();

                final File done = apk;
                getActivity().runOnUiThread(() -> {
                    JSObject ret = new JSObject();
                    if (!canInstall()) {
                        pendingApk = done;
                        Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                        s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getActivity().startActivity(s);
                        ret.put("status", "needs-permission");
                    } else {
                        launchInstaller(done);
                        ret.put("status", "started");
                    }
                    call.resolve(ret);
                });
            } catch (Exception e) {
                call.reject("Update download failed: " + e.getMessage());
            }
        });
    }

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void launchInstaller(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // User just came back from the "Install unknown apps" screen: continue the update.
        if (pendingApk != null && canInstall()) {
            File apk = pendingApk;
            pendingApk = null;
            launchInstaller(apk);
        }
    }
}
