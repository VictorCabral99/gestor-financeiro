package com.victor.gestor

import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.victor.gestor.databinding.ActivityMainBinding
import com.victor.gestor.update.AppRelease
import com.victor.gestor.update.downloadUpdate
import com.victor.gestor.update.lookForUpdate
import com.victor.gestor.update.skipVersion
import com.victor.gestor.update.skippedVersion
import com.victor.gestor.update.startInstall
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    /** O cabo encaminha esta porta do celular para a API do computador. */
    private val homeAccount = "http://127.0.0.1:3433"
    private lateinit var host: LocalHost
    private var updateJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        host = LocalHost(this) { accountUrl() }
        host.start()
        setupWeb()
        checkUpdate(force = false)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.web.canGoBack()) binding.web.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onDestroy() {
        updateJob?.cancel()
        host.stop()
        binding.web.destroy()
        super.onDestroy()
    }

    private fun setupWeb() {
        val web = binding.web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.setBackgroundColor(0xFFF6F4F1.toInt())
        web.addJavascriptInterface(ShellBridge(), "GestorAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val hostName = request.url.host
                return hostName != "127.0.0.1" && hostName != "localhost"
            }
        }
        web.loadUrl("http://127.0.0.1:${host.port}/")
    }

    private fun prefs() = getSharedPreferences("gestor", MODE_PRIVATE)

    private fun accountUrl(): String {
        val saved = prefs().getString("accountUrl", "").orEmpty().trim()
        return saved.ifBlank { homeAccount }
    }

    private inner class ShellBridge {
        @JavascriptInterface
        fun openAccount() {
            runOnUiThread { askAccount(required = false) }
        }

        @JavascriptInterface
        fun checkUpdate() {
            runOnUiThread { checkUpdate(force = true) }
        }
    }

    private fun askAccount(required: Boolean) {
        val input = EditText(this)
        input.inputType = EditorInfo.TYPE_TEXT_VARIATION_URI
        input.hint = "https://sua-conta"
        input.setText(accountUrl())
        input.setPadding(48, 24, 48, 24)
        val dialog = AlertDialog.Builder(this)
            .setTitle("Conta")
            .setMessage("Endereço da conta que liga o celular ao computador.")
            .setView(input)
            .setPositiveButton("Salvar", null)
            .setNegativeButton(if (required) "Depois" else "Fechar", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val raw = input.text.toString()
                if (raw.isBlank()) {
                    prefs().edit().remove("accountUrl").apply()
                    dialog.dismiss()
                    binding.web.reload()
                    return@setOnClickListener
                }
                if (LocalHost.normalizeAccount(raw) == null) {
                    toast("Use um endereço http ou https.")
                    return@setOnClickListener
                }
                prefs().edit().putString("accountUrl", raw.trim().trimEnd('/')).apply()
                dialog.dismiss()
                binding.web.reload()
            }
        }
        dialog.show()
    }

    private fun checkUpdate(force: Boolean) {
        updateJob?.cancel()
        updateJob = lifecycleScope.launch {
            val result = lookForUpdate(force)
            if (!force) {
                val found = result.getOrNull() ?: return@launch
                if (found.apkUrl == null || found.version == skippedVersion(this@MainActivity)) return@launch
                showUpdate(found)
                return@launch
            }
            result.onSuccess { found ->
                when {
                    found == null -> toast("Esta versão já é a mais nova.")
                    found.apkUrl == null -> toast("A versão ${found.version} ainda não tem o aplicativo.")
                    else -> showUpdate(found)
                }
            }.onFailure { toast(it.message ?: "Não deu para consultar as versões.") }
        }
    }

    private fun showUpdate(release: AppRelease) {
        val dialog = AlertDialog.Builder(this)
            .setTitle("Versão ${release.version}")
            .setMessage(release.notes)
            .setPositiveButton("Atualizar", null)
            .setNegativeButton("Agora não") { _, _ -> skipVersion(this, release.version) }
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                updateJob = lifecycleScope.launch {
                    try {
                        val apk = downloadUpdate(this@MainActivity, release) { progress ->
                            val percent = if (progress == null) "" else " ${(progress * 100).toInt()}%"
                            dialog.setMessage("${release.notes}\n\nBaixando…$percent")
                        }
                        val notice = startInstall(this@MainActivity, apk)
                        if (notice == null) dialog.dismiss() else {
                            dialog.setMessage("${release.notes}\n\n$notice")
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                        }
                    } catch (err: Exception) {
                        dialog.setMessage("${release.notes}\n\n${err.message ?: "O download falhou."}")
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                    }
                }
            }
        }
        dialog.show()
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
    }
}
