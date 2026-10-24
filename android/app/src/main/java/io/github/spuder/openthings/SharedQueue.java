package io.github.spuder.openthings;

import android.content.Context;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The hand-off between the parts of the app that don't run the web code (Share, the home screen
 * widgets) and the web app, which makes every write through the store so it lands in the op log.
 * Android's counterpart of the iOS App Group container (ios/App/Shared/OTShared.swift), with the
 * same file formats, in the app's own files directory:
 *
 *   openthings/pending/<millis>-<uuid>.json  a to-do to add (PendingItem in src/lib/native/snapshot.ts)
 *   openthings/route.txt                     an openthings:// link for the app to open
 *   openthings/snapshot.json                 what the widgets show (buildSnapshot in snapshot.ts)
 *
 * Share runs in the app's own process, so a listener (OpenThingsPlugin) hears about new items right
 * away when the app is running; otherwise the app imports them when it next starts or resumes.
 */
final class SharedQueue {

    interface Listener {
        void pendingChanged();
    }

    private static Listener listener;

    private SharedQueue() {}

    static synchronized void setListener(@Nullable Listener l) {
        listener = l;
    }

    private static File dir(Context c) {
        File d = new File(c.getFilesDir(), "openthings");
        d.mkdirs();
        return d;
    }

    private static File pendingDir(Context c) {
        File d = new File(dir(c), "pending");
        d.mkdirs();
        return d;
    }

    static File snapshotFile(Context c) {
        return new File(dir(c), "snapshot.json");
    }

    private static File routeFile(Context c) {
        return new File(dir(c), "route.txt");
    }

    /** Queue a to-do for the app to add. `target` is "inbox" or "dump". */
    static void enqueue(Context c, String text, @Nullable String notes, boolean parse, String target, String source)
        throws IOException, JSONException {
        String id = UUID.randomUUID().toString();
        JSONObject item = new JSONObject();
        item.put("id", id);
        item.put("text", text);
        if (notes != null) item.put("notes", notes);
        item.put("parse", parse);
        item.put("target", target);
        item.put("source", source);
        item.put("createdAt", iso(new Date()));
        writeAtomic(new File(pendingDir(c), System.currentTimeMillis() + "-" + id + ".json"), item.toString());
        notifyListener();
    }

    /** Queue an openthings:// link for the app to open (one at a time; the latest wins). */
    static void setRoute(Context c, String route) throws IOException {
        writeAtomic(routeFile(c), route);
        notifyListener();
    }

    /** Return the queued items, oldest first, and delete them. */
    static synchronized JSONArray takePending(Context c) {
        JSONArray out = new JSONArray();
        File[] files = pendingDir(c).listFiles((d, name) -> name.endsWith(".json"));
        if (files == null) return out;
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (File f : files) {
            try {
                out.put(new JSONObject(read(f)));
            } catch (IOException | JSONException e) {
                // A file that can't be read is dropped rather than retried forever.
            }
            f.delete();
        }
        return out;
    }

    @Nullable
    static synchronized String takeRoute(Context c) {
        File f = routeFile(c);
        if (!f.exists()) return null;
        try {
            String route = read(f).trim();
            return route.isEmpty() ? null : route;
        } catch (IOException e) {
            return null;
        } finally {
            f.delete();
        }
    }

    static void writeAtomic(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("Couldn't write " + f.getName());
    }

    static String read(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int n = 0;
            while (n < buf.length) {
                int r = in.read(buf, n, buf.length - n);
                if (r < 0) break;
                n += r;
            }
            return new String(buf, 0, n, StandardCharsets.UTF_8);
        }
    }

    private static void notifyListener() {
        Listener l;
        synchronized (SharedQueue.class) {
            l = listener;
        }
        if (l != null) l.pendingChanged();
    }

    private static String iso(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(d);
    }
}
