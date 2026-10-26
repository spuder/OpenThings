package io.github.spuder.openthings;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the home screen widgets (TodayWidget, SyncWidget) share. Like the iOS widgets they can't run
 * the web app: they read the snapshot it writes (OpenThingsPlugin.writeSnapshot, buildSnapshot in
 * src/lib/native/snapshot.ts) and open openthings:// links when tapped. They never write data.
 */
final class Widgets {

    static final String ACTION_MIDNIGHT = "io.github.spuder.openthings.WIDGETS_MIDNIGHT";

    private Widgets() {}

    /** The parts of the snapshot the widgets show. */
    static final class Snapshot {
        String day = "";
        final List<Item> today = new ArrayList<>();
        int todayCount;
        int eveningCount;
        String syncStatus = "local";
        int syncPending;
        @Nullable
        Date lastSyncedAt;
        @Nullable
        String syncError;

        /** Written on an earlier day: the list is yesterday's until the app runs again. */
        boolean isStale() {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            return day.compareTo(f.format(new Date())) < 0;
        }
    }

    static final class Item {
        String id;
        String title;
        boolean evening;
        @Nullable
        String container;
    }

    /** The snapshot, or null before the app has written one. */
    @Nullable
    static Snapshot read(Context c) {
        File f = SharedQueue.snapshotFile(c);
        if (!f.exists()) return null;
        try {
            JSONObject o = new JSONObject(SharedQueue.read(f));
            Snapshot s = new Snapshot();
            s.day = o.optString("day", "");
            JSONArray today = o.optJSONArray("today");
            for (int i = 0; today != null && i < today.length(); i++) {
                JSONObject t = today.getJSONObject(i);
                Item it = new Item();
                it.id = t.getString("id");
                it.title = t.optString("title", "");
                it.evening = t.optBoolean("evening", false);
                it.container = t.isNull("container") ? null : t.optString("container", null);
                s.today.add(it);
            }
            JSONObject counts = o.optJSONObject("counts");
            if (counts != null) {
                s.todayCount = counts.optInt("today", 0);
                s.eveningCount = counts.optInt("evening", 0);
            }
            JSONObject sync = o.optJSONObject("sync");
            if (sync != null) {
                s.syncStatus = sync.optString("status", "local");
                s.syncPending = sync.optInt("pending", 0);
                s.lastSyncedAt = sync.isNull("lastSyncedAt") ? null : parseIso(sync.optString("lastSyncedAt", ""));
                s.syncError = sync.isNull("error") ? null : sync.optString("error", null);
            }
            return s;
        } catch (Exception e) {
            return null;
        }
    }

    /** Redraw every OpenThings widget (after the app writes a new snapshot). */
    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        Snapshot s = read(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, TodayWidget.class))) TodayWidget.render(c, m, id, s);
        for (int id : m.getAppWidgetIds(new ComponentName(c, SyncWidget.class))) SyncWidget.render(c, m, id, s);
        scheduleMidnight(c);
    }

    /** Redraw once the day changes, so Today shows "Open OpenThings to refresh" instead of yesterday. */
    static void scheduleMidnight(Context c) {
        AlarmManager alarms = ContextCompat.getSystemService(c, AlarmManager.class);
        if (alarms == null) return;
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_YEAR, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 5);
        Intent intent = new Intent(c, TodayWidget.class).setAction(ACTION_MIDNIGHT);
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Inexact is fine (no exact-alarm permission needed): a few minutes after midnight.
        alarms.set(AlarmManager.RTC, next.getTimeInMillis(), pi);
    }

    /** Opens an openthings:// link in the app (src/lib/native/links.ts). */
    static PendingIntent open(Context c, String link, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link), c, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static int syncColor(Context c, String status) {
        switch (status) {
            case "idle":
                return ContextCompat.getColor(c, R.color.sync_ok);
            case "pending":
            case "syncing":
                return ContextCompat.getColor(c, R.color.accent);
            case "offline":
                return ContextCompat.getColor(c, R.color.sync_offline);
            case "error":
                return ContextCompat.getColor(c, R.color.sync_error);
            default:
                return ContextCompat.getColor(c, R.color.widget_text_tertiary);
        }
    }

    static String syncLabel(Context c, Snapshot s) {
        switch (s.syncStatus) {
            case "local":
                return c.getString(R.string.sync_local);
            case "idle":
                return c.getString(R.string.sync_idle);
            case "pending":
                return c.getString(R.string.sync_pending, s.syncPending);
            case "syncing":
                return c.getString(R.string.sync_syncing);
            case "offline":
                return s.syncPending > 0 ? c.getString(R.string.sync_offline_waiting, s.syncPending) : c.getString(R.string.sync_offline);
            case "error":
                return c.getString(R.string.sync_error);
            default:
                return s.syncStatus;
        }
    }

    @Nullable
    private static Date parseIso(String s) {
        for (String pattern : new String[] { "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'" }) {
            SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            try {
                return f.parse(s);
            } catch (ParseException e) {
                // try the next pattern
            }
        }
        return null;
    }
}
