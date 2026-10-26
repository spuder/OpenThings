package io.github.spuder.openthings;

import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins register before the bridge starts.
        registerPlugin(OpenThingsPlugin.class);
        super.onCreate(savedInstanceState);
        // The app's light or dark background (res/values-night) until the page paints, so a dark
        // launch doesn't flash white.
        getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.app_background));
    }
}
