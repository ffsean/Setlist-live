package com.example.setlist   // 要和你建立專案時的 package name 一致

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import androidx.activity.result.contract.ActivityResultContracts
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private val siteHost = "appassets.androidplatform.net"
    private lateinit var web: WebView
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null

    // ---- YT 直播：第二個 WebView（桌面版 YouTube + DVR + 手機直向鎖定 / 章節 / 打call 腳本）----
    private var ytWeb: WebView? = null
    private var active: WebView? = null      // 目前顯示的 WebView（全螢幕還原用）
    private var docStartOk = false
    private var ytBoot = ""
    private val ytAllowed = listOf("youtube.com", "youtu.be", "google.com", "google.co.jp", "googleusercontent.com", "gstatic.com")

    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val picker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCb?.onReceiveValue(uri?.let { arrayOf(it) }); fileCb = null
    }
    private var pendingText = ""
    private val saver = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri?.let { contentResolver.openOutputStream(it)?.use { o -> o.write(pendingText.toByteArray()) } }
    }

    inner class Bridge {
        @JavascriptInterface
        fun save(name: String, text: String) = runOnUiThread { pendingText = text; saver.launch(name) }

        @JavascriptInterface
        fun openExternal(url: String): Boolean {
            val u = Uri.parse(url)
            if (u.scheme != "https" && u.scheme != "http") return false
            runOnUiThread {
                val host = u.host ?: ""
                if (host.endsWith("youtube.com") || host == "youtu.be") {
                    // 先指定 YouTube App，沒安裝才交給系統挑選
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, u).setPackage("com.google.android.youtube"))
                        return@runOnUiThread
                    } catch (e: Exception) { }
                }
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
            }
            return true
        }

        @JavascriptInterface
        fun openLive(url: String) = runOnUiThread { openYt(url) }

        @JavascriptInterface
        fun bgPlay(): Boolean = getSharedPreferences("s", MODE_PRIVATE).getBoolean("bg", true)

        @JavascriptInterface
        fun setBgPlay(v: Boolean) { getSharedPreferences("s", MODE_PRIVATE).edit().putBoolean("bg", v).apply() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        show(web)

        // 避開狀態列 / 導覽列 / 鍵盤
        applyInsets(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }

        // 核心：在 youtube.com（含網頁裡嵌入的 iframe）載入前，先注入 DVR 腳本
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val script = assets.open("dvr.js").bufferedReader().use { it.readText() }
            WebViewCompat.addDocumentStartJavaScript(
                web, script,
                setOf("https://www.youtube.com", "https://m.youtube.com")
            )
        }

        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.addJavascriptInterface(LookupBridge(web, this), "LookupBridge")

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(r.url)

            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                return when (u.scheme) {
                    "http", "https" -> {
                        val host = u.host ?: return true
                        if (host == siteHost || host == "youtu.be" || host.endsWith("youtube.com")) false
                        else { try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }; true }
                    }
                    "intent" -> openIntent(u.toString(), web)
                    else -> true   // 其他 scheme 一律阻擋
                }
            }
        }

        // 讓嵌入播放器可以全螢幕
        web.webChromeClient = makeChrome(true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val yt = ytWeb
                when {
                    customView != null -> active?.webChromeClient?.onHideCustomView()
                    yt != null && active === yt -> if (yt.canGoBack()) yt.goBack() else closeYt()
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        web.loadUrl("https://$siteHost/assets/www/index.html")
    }

    // ================= YT 直播 =================

    private fun applyInsets(v: View) {
        ViewCompat.setOnApplyWindowInsetsListener(v) { view, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            view.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }
    }

    // 切換顯示的 WebView；被藏起來的那個暫停（避免兩邊同時出聲）
    private fun show(w: WebView) {
        active?.takeIf { it !== w }?.onPause()
        active = w
        w.onResume()
        setContentView(w)
    }

    private fun makeChrome(files: Boolean) = object : WebChromeClient() {
        override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
            if (!files) return false
            fileCb?.onReceiveValue(null); fileCb = cb; picker.launch("*/*"); return true
        }

        override fun onShowCustomView(view: View, cb: CustomViewCallback) {
            customView = view
            customCallback = cb
            setContentView(view)
            setBars(hide = true)
        }

        override fun onHideCustomView() {
            setContentView(active ?: web)
            customCallback?.onCustomViewHidden()
            customView = null
            customCallback = null
            setBars(hide = false)
        }
    }

    private fun allowedYtHost(h: String) = ytAllowed.any { h == it || h.endsWith(".$it") }

    // 桌面版 UA（同 Chrome「電腦版網站」）：腳本針對 www.youtube.com 桌面版 DOM 撰寫
    private fun desktopUa(base: String): String {
        val chrome = Regex("Chrome/[\\d.]+").find(base)?.value ?: "Chrome/124.0.0.0"
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) $chrome Safari/537.36"
    }

    private fun readAsset(name: String): String = assets.open(name).bufferedReader().use { it.readText() }

    inner class YtBridge {
        @JavascriptInterface
        fun save(name: String, text: String) = runOnUiThread { pendingText = text; saver.launch(name) }

        @JavascriptInterface
        fun close() = runOnUiThread { closeYt() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createYt(): WebView {
        val w = WebView(this)
        applyInsets(w)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = desktopUa(userAgentString)
            // 版面寬度 = WebView 寬度（CSS px），桌面版 YouTube 才不會縮成一片小字
            useWideViewPort = false
            loadWithOverviewMode = false
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, true)
        }

        // 注入內容：選單殼 → DVR（必須在頁面腳本之前）→ 手機直向鎖定 / 時鐘 / 章節 / 打call（等 DOM 就緒才跑）
        ytBoot = readAsset("yt-shim.js") + "\n" + readAsset("dvr.js") +
            "\n(function(){var run=function(){\n" + readAsset("yt-mobile-combo.user.js") +
            "\n};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run)}else{run()}})();"
        // 聊天室 iframe 也在 https://www.youtube.com，同樣會被注入
        docStartOk = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (docStartOk) {
            WebViewCompat.addDocumentStartJavaScript(w, ytBoot, setOf("https://www.youtube.com"))
        }

        w.addJavascriptInterface(YtBridge(), "YtBridge")

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                return when (u.scheme) {
                    "http", "https" -> {
                        val host = u.host ?: return true
                        if (allowedYtHost(host)) false
                        else { try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }; true }
                    }
                    "intent" -> openIntent(u.toString(), v)
                    else -> true
                }
            }

            // 舊版 WebView 不支援文件起始注入時的退路（只注入主頁面，聊天室 iframe 抓不到）
            override fun onPageFinished(v: WebView, url: String?) {
                if (!docStartOk && url != null && url.startsWith("https://www.youtube.com")) {
                    v.evaluateJavascript(ytBoot, null)
                }
            }
        }
        w.webChromeClient = makeChrome(false)
        return w
    }

    private fun openYt(raw: String?) {
        val yt = ytWeb ?: createYt().also { ytWeb = it }
        val u = raw?.trim().orEmpty()
        if (u.isNotEmpty() && isYt(Uri.parse(u))) yt.loadUrl(u)
        else if (yt.url == null) yt.loadUrl("https://www.youtube.com/")
        show(yt)
    }

    private fun closeYt() {
        ytWeb?.evaluateJavascript(
            "document.querySelectorAll('video').forEach(function(v){try{v.pause()}catch(e){}})", null
        )
        show(web)
    }

    private val ytPkgs = setOf("com.google.android.youtube", "com.google.android.apps.youtube.music")

    private fun isYt(u: Uri?) = u != null && u.scheme == "https" &&
        (u.host == "youtu.be" || u.host?.endsWith("youtube.com") == true)

    // intent:// 白名單：只放行 YouTube 網址 / YouTube App；失敗時改走 fallback 或 App 內開啟
    private fun openIntent(raw: String, target: WebView): Boolean {
        val intent = try { Intent.parseUri(raw, Intent.URI_INTENT_SCHEME) } catch (e: Exception) { return true }
        val fallback = intent.getStringExtra("browser_fallback_url")?.let { Uri.parse(it) }
        if (isYt(intent.data) && (intent.`package` == null || intent.`package` in ytPkgs)) {
            intent.addCategory(Intent.CATEGORY_BROWSABLE)
            intent.component = null
            intent.selector = null
            try { startActivity(intent); return true } catch (e: Exception) { }
        }
        val fb = if (isYt(fallback)) fallback else if (isYt(intent.data)) intent.data else null
        fb?.let { target.loadUrl(it.toString()) }
        return true
    }

    private fun setBars(hide: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (hide) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            c.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}


class HttpErr(val code: String, val retryMs: Long) : Exception()

/** 補資料用原生橋接：host 白名單、UA、各來源獨立速率佇列、single-flight、session 取消 */
class LookupBridge(private val web: WebView, private val act: AppCompatActivity) {
    private val ua = "SetlistLibrary/1.0 (personal use; Android WebView)"
    private val hosts = setOf("api.bgm.tv", "itunes.apple.com", "musicbrainz.org", "vocadb.net")
    private val gaps = mapOf("bangumi" to 2500L, "itunes" to 1200L, "musicbrainz" to 1100L, "vocadb" to 1000L)
    private val queues = gaps.keys.associateWith { Executors.newSingleThreadExecutor() }
    private val last = ConcurrentHashMap<String, Long>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    private val waiters = HashMap<String, MutableList<Pair<String, String>>>()   // flightKey -> (session, reqId)

    @JavascriptInterface
    fun cancel(session: String) { cancelled.add(session) }

    @JavascriptInterface
    fun lookup(source: String, query: String, queryKey: String, session: String, reqId: String) {
        val q = queues[source] ?: return deliver(reqId, err("bad_source", 0))
        val fk = "$source|$queryKey"
        var first = false
        synchronized(waiters) {
            val l = waiters[fk]
            if (l == null) { waiters[fk] = mutableListOf(session to reqId); first = true } else l.add(session to reqId)
        }
        if (!first) return   // single-flight：同來源同條件只發一個實際請求
        q.execute {
            val alive = synchronized(waiters) { waiters[fk]?.any { it.first !in cancelled } == true }
            val result = if (alive) run(source, query) else null   // 所屬 session 已取消就不打 API
            val ws = synchronized(waiters) { waiters.remove(fk) } ?: mutableListOf()
            if (result != null) ws.forEach { (s, r) -> if (s !in cancelled) deliver(r, result) }
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun err(code: String, retry: Long) = JSONObject().put("ok", false).put("code", code).put("retryAfterMs", retry).toString()
    private fun ok(body: String) = "{\"ok\":true,\"data\":$body}"

    private fun throttle(s: String) {
        val wait = (last[s] ?: 0L) + gaps.getValue(s) - System.currentTimeMillis()
        if (wait > 0) Thread.sleep(wait)
        last[s] = System.currentTimeMillis()
    }

    private fun run(s: String, q: String): String = try {
        throttle(s)
        when (s) {
            "itunes" -> ok(http("https://itunes.apple.com/search?media=music&entity=song&limit=10&country=JP&term=${enc(q)}", "GET", null))
            "musicbrainz" -> ok(http("https://musicbrainz.org/ws/2/recording?fmt=json&limit=10&query=${enc(q)}", "GET", null))
            "vocadb" -> ok(http("https://vocadb.net/api/songs?fields=Artists,AdditionalNames&maxResults=10&lang=Default&query=${enc(q)}", "GET", null))
            else -> ok(bangumi(q))
        }
    } catch (e: HttpErr) { err(e.code, e.retryMs) }
    catch (e: SocketTimeoutException) { err("timeout", 300000) }
    catch (e: IOException) { err("network", 300000) }
    catch (e: Exception) { err("parse_error", 300000) }

    private fun bangumi(q: String): String {
        val body = JSONObject().put("keyword", q).put("filter", JSONObject().put("type", JSONArray().put(3))).toString()
        val search = JSONObject(http("https://api.bgm.tv/v0/search/subjects?limit=5", "POST", body))
        val rel = JSONObject()
        val data = search.optJSONArray("data") ?: JSONArray()
        for (i in 0 until minOf(3, data.length())) {
            val id = data.getJSONObject(i).getInt("id")
            throttle("bangumi")
            try { rel.put(id.toString(), JSONArray(http("https://api.bgm.tv/v0/subjects/$id/subjects", "GET", null))) }
            catch (e: HttpErr) { if (e.code == "429") throw e } catch (e: Exception) { }
        }
        return JSONObject().put("search", search).put("rel", rel).toString()
    }

    private fun http(url: String, method: String, body: String?): String {
        val u = URL(url)
        if (u.protocol != "https" || u.host !in hosts) throw IOException("blocked")   // 原生層再驗證
        val c = u.openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 8000; c.readTimeout = 8000
        c.instanceFollowRedirects = false   // 不跟隨轉址，避免跳出白名單
        c.setRequestProperty("User-Agent", ua)
        c.setRequestProperty("Accept", "application/json")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = c.responseCode
        if (code == 429 || code == 503) throw HttpErr("429", (c.getHeaderField("Retry-After")?.toLongOrNull() ?: 300L) * 1000)
        if (code == 403) throw HttpErr("403", 300000)
        if (code !in 200..299) throw HttpErr("http_$code", 300000)
        return c.inputStream.bufferedReader().use { it.readText() }
    }

    private fun deliver(reqId: String, json: String) {
        act.runOnUiThread {
            web.evaluateJavascript("window.__lookupDone&&window.__lookupDone(${JSONObject.quote(reqId)},${JSONObject.quote(json)})", null)
        }
    }
}
