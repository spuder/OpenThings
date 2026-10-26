package io.github.spuder.openthings;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.Nullable;

/**
 * Today on the home screen (iOS: TodayWidget in ios/App/OpenThingsWidgets/OpenThingsWidgets.swift).
 * Shows as many to-dos as fit, then "+N more"; a row opens that to-do, anywhere else opens Today.
 * Resizable; wide widgets also show each to-do's project or area.
 */
public class TodayWidget extends AppWidgetProvider {

    private static final int ROW_DP = 30;
    private static final int MAX_ROWS = 11;

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.Snapshot s = Widgets.read(c);
        for (int id : ids) render(c, m, id, s);
        Widgets.scheduleMidnight(c);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle options) {
        render(c, m, id, Widgets.read(c));
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (Widgets.ACTION_MIDNIGHT.equals(intent.getAction())) Widgets.refreshAll(c);
        else super.onReceive(c, intent);
    }

    static void render(Context c, AppWidgetManager m, int id, @Nullable Widgets.Snapshot s) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        v.setOnClickPendingIntent(android.R.id.background, Widgets.open(c, "openthings://today", id * 100));
        v.removeAllViews(R.id.widget_rows);
        v.setViewVisibility(R.id.widget_more, View.GONE);

        if (s == null) {
            v.setTextViewText(R.id.widget_count, "");
            v.setViewVisibility(R.id.widget_sync_dot, View.GONE);
            showMessage(v, c.getString(R.string.widget_open_once));
            m.updateAppWidget(id, v);
            return;
        }

        int open = s.todayCount + s.eveningCount;
        v.setTextViewText(R.id.widget_count, String.valueOf(open));
        v.setViewVisibility(R.id.widget_sync_dot, View.VISIBLE);
        v.setInt(R.id.widget_sync_dot, "setColorFilter", Widgets.syncColor(c, s.syncStatus));

        if (s.isStale()) {
            showMessage(v, c.getString(R.string.widget_stale));
        } else if (s.today.isEmpty()) {
            showMessage(v, c.getString(R.string.widget_nothing_left));
        } else {
            v.setViewVisibility(R.id.widget_message, View.GONE);
            Bundle size = m.getAppWidgetOptions(id);
            int heightDp = size.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110);
            int widthDp = size.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180);
            // Padding, header and the "+N more" line take about 76dp.
            int fit = Math.max(1, Math.min(MAX_ROWS, (heightDp - 76) / ROW_DP));
            int shown = Math.min(fit, s.today.size());
            boolean wide = widthDp >= 250;
            for (int i = 0; i < shown; i++) {
                Widgets.Item t = s.today.get(i);
                RemoteViews row = new RemoteViews(c.getPackageName(), R.layout.widget_today_row);
                row.setTextViewText(R.id.widget_row_title, t.title);
                if (wide && t.container != null) {
                    row.setTextViewText(R.id.widget_row_container, t.container);
                    row.setViewVisibility(R.id.widget_row_container, View.VISIBLE);
                }
                if (t.evening) row.setViewVisibility(R.id.widget_row_evening, View.VISIBLE);
                row.setOnClickPendingIntent(R.id.widget_row, Widgets.open(c, "openthings://task/" + Uri.encode(t.id), id * 100 + 1 + i));
                v.addView(R.id.widget_rows, row);
            }
            int more = open - shown;
            if (more > 0) {
                v.setTextViewText(R.id.widget_more, c.getString(R.string.widget_more, more));
                v.setViewVisibility(R.id.widget_more, View.VISIBLE);
            }
        }
        m.updateAppWidget(id, v);
    }

    private static void showMessage(RemoteViews v, String text) {
        v.setTextViewText(R.id.widget_message, text);
        v.setViewVisibility(R.id.widget_message, View.VISIBLE);
    }
}
