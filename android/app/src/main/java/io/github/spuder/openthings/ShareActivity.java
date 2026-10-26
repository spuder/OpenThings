package io.github.spuder.openthings;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Share to OpenThings from other apps (a page from Chrome, text from Notes…), and "Add to
 * OpenThings" in the text selection menu. Android's counterpart of the iOS Share extension
 * (ios/App/OpenThingsShare/ShareViewController.swift): a small dialog to edit the title and pick
 * Inbox or Brain Dump. It doesn't write the database: it queues the to-do (SharedQueue) and the app
 * adds it through the store, right away if it's running, otherwise when it next opens.
 */
public class ShareActivity extends AppCompatActivity {

    private static final Pattern URL = Pattern.compile("https?://\\S+");

    private EditText title;
    private TextView urlView;
    private RadioGroup target;
    private TextView hint;
    private Button add;
    @Nullable
    private String url;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_share);
        getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);

        title = findViewById(R.id.share_title);
        urlView = findViewById(R.id.share_url);
        target = findViewById(R.id.share_target);
        hint = findViewById(R.id.share_hint);
        add = findViewById(R.id.share_add);

        if (savedInstanceState == null) readIntent(getIntent());
        if (url != null) {
            urlView.setText(url);
            urlView.setVisibility(View.VISIBLE);
        }

        title.addTextChangedListener(
            new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {}

                @Override
                public void afterTextChanged(Editable s) {
                    updateAdd();
                }
            }
        );
        target.setOnCheckedChangeListener(
            (group, id) -> hint.setText(id == R.id.share_dump ? R.string.share_hint_dump : R.string.share_hint_inbox)
        );
        findViewById(R.id.share_cancel).setOnClickListener(v -> finish());
        add.setOnClickListener(v -> save());
        updateAdd();

        title.requestFocus();
        title.setSelection(title.getText().length());
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    private void readIntent(Intent intent) {
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            offer(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT));
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            // Browsers share the page's address as the text and its title as the subject.
            offer(intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
            offer(intent.getStringExtra(Intent.EXTRA_SUBJECT));
        }
    }

    /** Take a link out of shared text; the rest becomes the title if there isn't one yet. */
    private void offer(@Nullable CharSequence shared) {
        if (shared == null) return;
        String text = shared.toString().trim();
        if (url == null) {
            Matcher m = URL.matcher(text);
            if (m.find()) {
                url = m.group();
                text = (text.substring(0, m.start()) + text.substring(m.end())).trim();
            }
        }
        if (title.getText().toString().trim().isEmpty() && !text.isEmpty()) title.setText(text);
    }

    private void updateAdd() {
        add.setEnabled(!title.getText().toString().trim().isEmpty() || url != null);
    }

    private void save() {
        String text = title.getText().toString().trim();
        boolean dump = target.getCheckedRadioButtonId() == R.id.share_dump;
        try {
            // Taken literally (parse false): shared text often has '#', '@' or '//' that aren't quick-add syntax.
            SharedQueue.enqueue(
                this,
                text.isEmpty() ? url : text,
                text.isEmpty() ? null : url,
                false,
                dump ? "dump" : "inbox",
                "share"
            );
        } catch (Exception e) {
            Toast.makeText(this, getString(R.string.share_failed, e.getMessage()), Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, dump ? R.string.share_added_dump : R.string.share_added_inbox, Toast.LENGTH_SHORT).show();
        finish();
    }
}
