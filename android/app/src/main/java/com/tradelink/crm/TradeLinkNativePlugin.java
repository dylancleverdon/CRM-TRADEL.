package com.tradelink.crm;

import android.Manifest;
import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.GroupMembership;
import android.provider.ContactsContract.CommonDataKinds.Note;
import android.provider.ContactsContract.CommonDataKinds.Organization;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
import android.provider.Settings;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
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
import java.util.ArrayList;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native helpers for TradeLink CRM:
 *  - call():       one-tap phone calls through the phone's own SIM/number
 *  - http():       network requests without browser CORS limits (Google Apps Script sync, update checks)
 *  - installApk(): self-update by downloading the newest APK and opening the Android installer
 *  - saveContact(): saves a called number to the phone's contacts under a Google account, so it syncs to
 *                   Google Contacts and shows as caller ID; listAccounts(): Google accounts syncing contacts here
 */
@CapacitorPlugin(
    name = "TradeLinkNative",
    permissions = {
        @Permission(strings = { Manifest.permission.CALL_PHONE }, alias = "call"),
        @Permission(strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS }, alias = "contacts")
    }
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

    // --------------------------------------------------------------- contacts

    private static final String GOOGLE = "com.google";

    @PluginMethod
    public void saveContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermsCallback");
            return;
        }
        executor.execute(() -> doSaveContact(call));
    }

    @PluginMethod
    public void listAccounts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermsCallback");
            return;
        }
        executor.execute(() -> doListAccounts(call));
    }

    @PermissionCallback
    private void contactsPermsCallback(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contacts permission is off", "denied");
            return;
        }
        if ("listAccounts".equals(call.getMethodName())) executor.execute(() -> doListAccounts(call));
        else executor.execute(() -> doSaveContact(call));
    }

    private void doListAccounts(PluginCall call) {
        try {
            JSArray list = new JSArray();
            for (String a : googleAccounts()) list.put(a);
            JSObject ret = new JSObject();
            ret.put("accounts", list);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read accounts: " + e.getMessage());
        }
    }

    /** Google accounts that sync contacts on this phone (seen through their contact groups / contacts). */
    private Set<String> googleAccounts() {
        Set<String> names = new TreeSet<>();
        ContentResolver cr = getContext().getContentResolver();
        Uri[] tables = { ContactsContract.Groups.CONTENT_URI, ContactsContract.RawContacts.CONTENT_URI };
        for (Uri table : tables) {
            try (Cursor c = cr.query(table, new String[] { ContactsContract.RawContacts.ACCOUNT_NAME },
                    ContactsContract.RawContacts.ACCOUNT_TYPE + "=?", new String[] { GOOGLE }, null)) {
                while (c != null && c.moveToNext()) {
                    String n = c.getString(0);
                    if (n != null && !n.isEmpty()) names.add(n);
                }
            } catch (Exception ignored) { }
        }
        try {
            for (Account a : AccountManager.get(getContext()).getAccountsByType(GOOGLE)) names.add(a.name);
        } catch (Exception ignored) { }
        return names;
    }

    private void doSaveContact(PluginCall call) {
        try {
            String phone = call.getString("phone", "");
            String name = call.getString("name", "");
            String company = call.getString("company", "");
            String title = call.getString("title", "");
            String note = call.getString("note", "");
            String account = call.getString("account", "");
            String group = call.getString("group", "TradeLink CRM");
            if (phone == null || phone.replaceAll("[^0-9]", "").length() < 7) {
                call.reject("No phone number");
                return;
            }
            ContentResolver cr = getContext().getContentResolver();
            JSObject ret = new JSObject();

            // Already in contacts (any format, any account)? Leave it as it is.
            Uri lookup = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
            try (Cursor c = cr.query(lookup, new String[] { ContactsContract.PhoneLookup.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    ret.put("status", "exists");
                    ret.put("name", c.getString(0));
                    call.resolve(ret);
                    return;
                }
            }

            // Only attach it to the Google account if that account syncs contacts on this phone;
            // otherwise it's saved on the phone only (a missing account would drop the contact later).
            boolean synced = account != null && !account.isEmpty() && googleAccounts().contains(account);
            String display = name.isEmpty() ? company : (company.isEmpty() ? name : name + " \u2013 " + company);

            ArrayList<ContentProviderOperation> ops = new ArrayList<>();
            ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, synced ? GOOGLE : null)
                .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, synced ? account : null)
                .build());
            ops.add(dataRow(StructuredName.CONTENT_ITEM_TYPE).withValue(StructuredName.DISPLAY_NAME, display).build());
            ops.add(dataRow(Phone.CONTENT_ITEM_TYPE).withValue(Phone.NUMBER, phone).withValue(Phone.TYPE, Phone.TYPE_WORK).build());
            if (!company.isEmpty() || !title.isEmpty())
                ops.add(dataRow(Organization.CONTENT_ITEM_TYPE).withValue(Organization.COMPANY, company).withValue(Organization.TITLE, title).build());
            if (!note.isEmpty()) ops.add(dataRow(Note.CONTENT_ITEM_TYPE).withValue(Note.NOTE, note).build());
            if (synced) {
                long gid = groupId(cr, account, group);
                if (gid > 0) ops.add(dataRow(GroupMembership.CONTENT_ITEM_TYPE).withValue(GroupMembership.GROUP_ROW_ID, gid).build());
            }
            cr.applyBatch(ContactsContract.AUTHORITY, ops);
            ret.put("status", synced ? "saved" : "saved-on-phone");
            ret.put("account", synced ? account : "");
            ret.put("name", display);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the contact: " + e.getMessage());
        }
    }

    private static ContentProviderOperation.Builder dataRow(String mimeType) {
        return ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
            .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
            .withValue(ContactsContract.Data.MIMETYPE, mimeType);
    }

    /** The "TradeLink CRM" label in that Google account (created the first time). */
    private long groupId(ContentResolver cr, String account, String title) {
        try (Cursor c = cr.query(ContactsContract.Groups.CONTENT_URI, new String[] { ContactsContract.Groups._ID },
                ContactsContract.Groups.ACCOUNT_NAME + "=? AND " + ContactsContract.Groups.ACCOUNT_TYPE + "=? AND "
                    + ContactsContract.Groups.TITLE + "=? AND " + ContactsContract.Groups.DELETED + "=0",
                new String[] { account, GOOGLE, title }, null)) {
            if (c != null && c.moveToFirst()) return c.getLong(0);
        } catch (Exception ignored) { }
        try {
            ContentValues v = new ContentValues();
            v.put(ContactsContract.Groups.ACCOUNT_NAME, account);
            v.put(ContactsContract.Groups.ACCOUNT_TYPE, GOOGLE);
            v.put(ContactsContract.Groups.TITLE, title);
            v.put(ContactsContract.Groups.GROUP_VISIBLE, 1);
            v.put(ContactsContract.Groups.SHOULD_SYNC, 1);
            Uri u = cr.insert(ContactsContract.Groups.CONTENT_URI, v);
            return u == null ? -1 : ContentUris.parseId(u);
        } catch (Exception e) {
            return -1;
        }
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
