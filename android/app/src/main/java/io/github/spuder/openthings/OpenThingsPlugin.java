package io.github.spuder.openthings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Android side of the "OpenThingsNative" plugin (iOS: ios/App/App/OpenThingsPlugin.swift), with
 * the same methods, called from src/lib/native/capacitor.svelte.ts:
 *
 *   writeSnapshot({ json })  saves what the home screen widgets show, and refreshes them
 *   takePending()            { items, route }: to-dos queued by Share, deleted as they're returned
 *   info()                   diagnostics for Settings
 *   scanQRCode()             the pairing QR code, with Google's code scanner from Play services
 *                            (its own camera screen, no camera permission)
 *   event pendingChanged     Share queued something while the app is running
 *
 * Where iOS uses the App Group container, Android uses the app's own files (SharedQueue). See docs/android.md.
 */
@CapacitorPlugin(name = "OpenThingsNative")
public class OpenThingsPlugin extends Plugin {

    @Override
    public void load() {
        SharedQueue.setListener(() -> notifyListeners("pendingChanged", new JSObject()));
    }

    @Override
    protected void handleOnDestroy() {
        SharedQueue.setListener(null);
    }

    @PluginMethod
    public void writeSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Missing json");
            return;
        }
        try {
            SharedQueue.writeAtomic(SharedQueue.snapshotFile(getContext()), json);
            call.resolve();
        } catch (IOException e) {
            call.reject("Couldn't write the widget snapshot: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSONArray taken = SharedQueue.takePending(getContext());
        JSArray items = new JSArray();
        for (int i = 0; i < taken.length(); i++) {
            JSONObject item = taken.optJSONObject(i);
            if (item == null) continue;
            try {
                items.put(JSObject.fromJSONObject(item));
            } catch (JSONException e) {
                // Skip an item that isn't valid JSON.
            }
        }
        String route = SharedQueue.takeRoute(getContext());
        JSObject ret = new JSObject();
        ret.put("items", items);
        ret.put("route", route == null ? JSONObject.NULL : route);
        call.resolve(ret);
    }

    @PluginMethod
    public void info(PluginCall call) {
        // No App Group on Android: Share and widgets use the app's own files, always available.
        JSObject ret = new JSObject();
        ret.put("appGroup", "");
        ret.put("containerAvailable", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void scanQRCode(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner
            .startScan()
            .addOnSuccessListener(barcode -> {
                String value = barcode.getRawValue();
                if (value == null || value.isEmpty()) {
                    call.reject("The QR code has no text", "EMPTY");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("value", value);
                call.resolve(ret);
            })
            .addOnCanceledListener(() -> call.reject("Scanning cancelled", "CANCELLED"))
            .addOnFailureListener(e -> {
                // The scanner module downloads on first use; without Play services or a network it can't start.
                boolean unavailable = e instanceof MlKitException
                    && ((MlKitException) e).getErrorCode() == MlKitException.UNAVAILABLE;
                call.reject(
                    unavailable ? "The QR scanner isn't available yet: Google Play services is still downloading it, or isn't on this device." : e.getMessage(),
                    unavailable ? "UNAVAILABLE" : "FAILED",
                    e
                );
            });
    }
}
