package com.chasiq.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.File;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Minimal native shell for the Chasiq web app.
 *
 * The catalog, accounts, cloud sync and marketplace live in the web app.
 * This activity deliberately has no third-party dependencies: it provides
 * the native pieces a browser tab cannot, notably file picking, camera /
 * microphone permission bridging for getUserMedia, downloads and Android
 * back-button behaviour.
 */
public class MainActivity extends Activity {
    private static final String HOME_URL = "https://chasiq.onrender.com";
    private static final int FILE_CHOOSER_REQUEST = 7001;
    private static final int MEDIA_PERMISSION_REQUEST = 7002;

    private WebView webView;
    private long lastBackHandledMs = 0;
    private long lastExitWarnMs = 0;
    private OnBackInvokedCallback backInvokedCallback;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private String[] pendingPermissionResources;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(0x0b, 0x0c, 0x0e));
        getWindow().setNavigationBarColor(Color.rgb(0x0b, 0x0c, 0x0e));

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.rgb(0x0b, 0x0c, 0x0e));
        setContentView(webView);

        // Android 15+ renders edge-to-edge, so without this the page slides
        // under the status bar at the top and the gesture/navigation bar at
        // the bottom (hiding the app's fixed bottom nav). Shrink the WebView
        // itself with layout MARGINS equal to the system-bar insets — the
        // Chromium viewport follows the measured size. (Padding the WebView
        // does NOT reliably shrink its web viewport; v1.0.1 proved that on
        // device.) The page then always sits between the two system bars.
        webView.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars =
                        insets.getInsets(android.view.WindowInsets.Type.systemBars());
                top = bars.top; bottom = bars.bottom;
                left = bars.left; right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            android.view.ViewGroup.MarginLayoutParams mlp =
                    (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
            if (mlp != null
                    && (mlp.topMargin != top || mlp.bottomMargin != bottom
                        || mlp.leftMargin != left || mlp.rightMargin != right)) {
                mlp.setMargins(left, top, right, bottom);
                v.setLayoutParams(mlp);
            }
            return insets;
        });
        webView.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        // Tag the UA so the web app can show the shell version (More tab) —
        // keep this string in step with --version-name in build-manual.sh.
        settings.setUserAgentString(settings.getUserAgentString() + " ChasiqShell/1.0.4");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // App behaviour, not browser behaviour: the page's own viewport meta
        // (width=device-width) rules. A wide/overview viewport made the page
        // render wider than the screen so it panned sideways, and zoom let a
        // stray double-tap leave it magnified. Both off, zoom off.
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setSupportZoom(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new ChasiqWebViewClient());
        webView.setWebChromeClient(new ChasiqChromeClient());
        webView.setDownloadListener(new ChasiqDownloadListener());

        // Always start fresh at home: restoring WebView state also restores
        // a saved scroll/scale, which kept resurrecting a zoomed-in page.
        // App state lives in the web app's own storage, not here.
        // Android 13+ predictive back: route the system back gesture through
        // handleBack(). Older versions reach handleBack() via onBackPressed().
        if (Build.VERSION.SDK_INT >= 33) {
            backInvokedCallback = () -> handleBack();
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backInvokedCallback);
        }
        webView.loadUrl(HOME_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (pendingPermissionRequest != null) {
            pendingPermissionRequest.deny();
            pendingPermissionRequest = null;
            pendingPermissionResources = null;
        }
        if (Build.VERSION.SDK_INT >= 33 && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * Back behaviour the user asked for: step back through the app's screens
     * first (the web app keeps a real history stack), and only exit from the
     * root screen after a confirming second press within 2 seconds.
     * One physical press can arrive via two paths (legacy onBackPressed and
     * the Android 13+ invoked callback), so calls inside 350 ms are deduped.
     */
    private void handleBack() {
        long now = System.currentTimeMillis();
        if (now - lastBackHandledMs < 350) return;
        lastBackHandledMs = now;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (now - lastExitWarnMs < 2000) {
            finish();
            return;
        }
        lastExitWarnMs = now;
        Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST) return;

        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        if (callback == null) return;

        Uri[] results = null;
        if (resultCode == Activity.RESULT_OK) {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        callback.onReceiveValue(results);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingPermissionRequest == null) return;

        PermissionRequest request = pendingPermissionRequest;
        String[] requestedResources = pendingPermissionResources;
        pendingPermissionRequest = null;
        pendingPermissionResources = null;

        List<String> granted = new ArrayList<>();
        if (requestedResources != null) {
            for (String resource : requestedResources) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                        && checkSelfPermission(Manifest.permission.CAMERA)
                                == PackageManager.PERMISSION_GRANTED) {
                    granted.add(resource);
                } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                == PackageManager.PERMISSION_GRANTED) {
                    granted.add(resource);
                }
            }
        }
        if (granted.isEmpty()) {
            request.deny();
        } else {
            request.grant(granted.toArray(new String[0]));
        }
    }

    private boolean isInternalHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase();
        return h.equals("chasiq.onrender.com")
                || h.equals("wsrv.nl") || h.endsWith(".wsrv.nl")
                || h.equals("wikia.nocookie.net") || h.endsWith(".wikia.nocookie.net");
    }

    private boolean shouldOpenExternally(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase();
        if ("http".equals(scheme) || "https".equals(scheme)) {
            return !isInternalHost(uri.getHost());
        }
        return "tel".equals(scheme) || "mailto".equals(scheme) || "sms".equals(scheme)
                || "smsto".equals(scheme) || "geo".equals(scheme) || "market".equals(scheme)
                || "intent".equals(scheme);
    }

    private boolean openExternal(String url) {
        try {
            Intent intent;
            if (url.startsWith("intent://")) {
                intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null
                        && getPackageManager().resolveActivity(intent,
                                PackageManager.MATCH_DEFAULT_ONLY) == null) {
                    intent = new Intent(Intent.ACTION_VIEW, Uri.parse(fallback));
                }
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
            }
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | URISyntaxException e) {
            Toast.makeText(this, "No app found to open that link", Toast.LENGTH_SHORT).show();
            return true; // Handled: do not let the WebView try to load it.
        }
    }

    private class ChasiqWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null || !request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            return uri != null && shouldOpenExternally(uri) && openExternal(uri.toString());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url == null) return false;
            Uri uri = Uri.parse(url);
            return shouldOpenExternally(uri) && openExternal(url);
        }
    }

    private class ChasiqChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view,
                                         ValueCallback<Uri[]> callback,
                                         FileChooserParams fileChooserParams) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            Intent intent = null;
            if (fileChooserParams != null) {
                try {
                    intent = fileChooserParams.createIntent();
                } catch (RuntimeException ignored) {
                    intent = null;
                }
            }
            if (intent == null) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
            }
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            if (fileChooserParams != null
                    && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            // A null MIME type can make some OEM pickers show nothing useful.
            if (intent.getType() == null || intent.getType().isEmpty()) {
                String[] accepts = fileChooserParams == null
                        ? null : fileChooserParams.getAcceptTypes();
                intent.setType(accepts != null && accepts.length > 0
                        && accepts[0] != null && !accepts[0].isEmpty()
                        ? accepts[0] : "*/*");
            }
            try {
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
            } catch (ActivityNotFoundException e) {
                filePathCallback = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this,
                        "No file picker is available", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleMediaPermissionRequest(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingPermissionRequest == request) {
                pendingPermissionRequest = null;
                pendingPermissionResources = null;
            }
        }
    }

    private void handleMediaPermissionRequest(PermissionRequest request) {
        String[] resources = request.getResources();
        if (resources == null || resources.length == 0) {
            request.deny();
            return;
        }

        List<String> missingPermissions = new ArrayList<>();
        boolean hasSupportedResource = false;
        for (String resource : resources) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                hasSupportedResource = true;
                if (checkSelfPermission(Manifest.permission.CAMERA)
                        != PackageManager.PERMISSION_GRANTED) {
                    missingPermissions.add(Manifest.permission.CAMERA);
                }
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                hasSupportedResource = true;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    missingPermissions.add(Manifest.permission.RECORD_AUDIO);
                }
            }
        }
        if (!hasSupportedResource) {
            request.deny();
            return;
        }
        if (missingPermissions.isEmpty()) {
            // Grant only media resources this shell intentionally supports.
            List<String> supported = new ArrayList<>();
            for (String resource : resources) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                        || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    supported.add(resource);
                }
            }
            request.grant(supported.toArray(new String[0]));
            return;
        }

        // Ask Android for the missing runtime permission(s), then answer the
        // pending web request from onRequestPermissionsResult.
        if (pendingPermissionRequest != null) {
            pendingPermissionRequest.deny();
        }
        pendingPermissionRequest = request;
        pendingPermissionResources = Arrays.copyOf(resources, resources.length);
        requestPermissions(missingPermissions.toArray(new String[0]),
                MEDIA_PERMISSION_REQUEST);
    }

    private class ChasiqDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url,
                                    String userAgent,
                                    String contentDisposition,
                                    String mimeType,
                                    long contentLength) {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                Toast.makeText(MainActivity.this,
                        "That download cannot be handled by the app", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                String guessed = URLUtil.guessFileName(url, contentDisposition, mimeType);
                String fileName = guessed == null ? "chasiq-download" : new File(guessed).getName();
                if (fileName == null || fileName.trim().isEmpty()) fileName = "chasiq-download";

                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                request.setTitle(fileName);
                request.setDescription("Downloading from Chasiq");
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(true);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, fileName);

                DownloadManager manager =
                        (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager == null) throw new IllegalStateException("No DownloadManager");
                manager.enqueue(request);
                Toast.makeText(MainActivity.this,
                        "Downloading " + fileName, Toast.LENGTH_SHORT).show();
            } catch (RuntimeException e) {
                // Fallback required by the shell spec: let the browser own it.
                openExternal(url);
            }
        }
    }
}
