package io.github.spuder.openthings;

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

/**
 * The Android side of the "OpenThingsNative" plugin (iOS: ios/App/App/OpenThingsPlugin.swift).
 *
 * Android has only the QR code scanner for pairing a phone (Settings, Sync, Scan QR code). It uses
 * Google's code scanner from Play services, which shows its own camera screen and needs no camera
 * permission. Widgets and the share inbox are iOS-only for now; src/lib/native/capacitor.svelte.ts
 * calls those methods on iOS only. See docs/android.md.
 */
@CapacitorPlugin(name = "OpenThingsNative")
public class OpenThingsPlugin extends Plugin {

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
