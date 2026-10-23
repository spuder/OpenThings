package io.github.spuder.openthings;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.text.TextUtils;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.List;

/**
 * Sync status on the home screen (iOS: SyncWidget in ios/App/OpenThingsWidgets/OpenThingsWidgets.swift):
 * synced, waiting, offline or an error, and when it last synced. Tapping opens the app.
 */
public class SyncWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.Snapshot s = Widgets.read(c);
        for (int id : ids) render(c, m, id, s);
    }

    static void render(Context c, AppWidgetManager m, int id, @Nullable Widgets.Snapshot s) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_sync);
        v.setOnClickPendingIntent(android.R.id.background, Widgets.open(c, "openthings://today", id * 100));
        if (s == null) {
            v.setTextViewText(R.id.widget_sync_label, c.getString(R.string.widget_open_once_short));
            v.setInt(R.id.widget_sync_dot, "setColorFilter", Widgets.syncColor(c, "local"));
            v.setViewVisibility(R.id.widget_sync_detail, View.GONE);
            m.updateAppWidget(id, v);
            return;
        }
        v.setTextViewText(R.id.widget_sync_label, Widgets.syncLabel(c, s));
        v.setInt(R.id.widget_sync_dot, "setColorFilter", Widgets.syncColor(c, s.syncStatus));

        List<String> detail = new ArrayList<>();
        if (s.lastSyncedAt != null) {
            CharSequence ago = DateUtils.getRelativeTimeSpanString(
                s.lastSyncedAt.getTime(),
                System.currentTimeMillis(),
                DateUtils.MINUTE_IN_MILLIS
            );
            detail.add(c.getString(R.string.sync_last, ago));
        } else if ("local".equals(s.syncStatus)) {
            detail.add(c.getString(R.string.sync_local_detail));
        }
        if ("error".equals(s.syncStatus) && s.syncError != null && !s.syncError.isEmpty()) detail.add(s.syncError);
        v.setTextViewText(R.id.widget_sync_detail, TextUtils.join("\n", detail));
        v.setViewVisibility(R.id.widget_sync_detail, detail.isEmpty() ? View.GONE : View.VISIBLE);
        m.updateAppWidget(id, v);
    }
}
