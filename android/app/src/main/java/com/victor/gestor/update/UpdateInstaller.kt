package com.victor.gestor.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.victor.gestor.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

private val gate = Mutex()
private val downloads = Mutex()
private var cachedAt = 0L
private var cached: Result<AppRelease?>? = null

private fun prefs(context: Context) = context.getSharedPreferences("gestor-update", Context.MODE_PRIVATE)

fun skippedVersion(context: Context): String? = prefs(context).getString("skipped", null)

fun skipVersion(context: Context, version: String) {
    prefs(context).edit().putString("skipped", version).apply()
}

/** Consulta o repositório do gestor. O resultado fica guardado por uma hora, fora quando a busca é manual. */
suspend fun lookForUpdate(force: Boolean = false): Result<AppRelease?> = gate.withLock {
    val now = System.currentTimeMillis()
    val hit = cached
    if (!force && hit != null && now - cachedAt < 60 * 60 * 1000) return@withLock hit
    val result = runCatching { withContext(Dispatchers.IO) { fetchLatest() } }
    cached = result
    cachedAt = now
    result
}

private fun fetchLatest(): AppRelease? {
    val conn = open(UPDATES_URL, "application/vnd.github+json")
    try {
        val code = conn.responseCode
        if (code == 404) return null
        if (code == 403) error("O GitHub limitou as consultas. Tente de novo daqui a pouco.")
        if (code !in 200..299) error("Não deu para consultar as versões.")
        val raw = conn.inputStream.bufferedReader().use { it.readText() }
        return pickUpdate(BuildConfig.VERSION_NAME, parseReleases(raw))
    } finally {
        conn.disconnect()
    }
}

private fun open(url: String, accept: String): HttpURLConnection {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.instanceFollowRedirects = true
    conn.connectTimeout = 20_000
    conn.readTimeout = 60_000
    conn.setRequestProperty("User-Agent", "Gestor")
    conn.setRequestProperty("Accept", accept)
    return conn
}

private fun apkFile(context: Context, version: String) = File(context.cacheDir, "gestor-$version.apk")

private fun archiveInfo(context: Context, file: File): PackageInfo? {
    val pm = context.packageManager
    return if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(file.path, PackageManager.PackageInfoFlags.of(0))
    else pm.getPackageArchiveInfo(file.path, 0)
}

private fun PackageInfo.code(): Long = if (Build.VERSION.SDK_INT >= 28) longVersionCode else @Suppress("DEPRECATION") versionCode.toLong()

private fun explainApk(context: Context, file: File): String? {
    val info = archiveInfo(context, file) ?: return "O arquivo baixado não é um APK."
    if (info.packageName != context.packageName) return "O arquivo baixado é de outro aplicativo."
    if (info.code() <= BuildConfig.VERSION_CODE) return "O arquivo publicado não é mais novo que esta versão."
    return null
}

/** Baixa o APK. Se ele já estiver no aparelho e for válido, não baixa de novo. */
suspend fun downloadUpdate(context: Context, release: AppRelease, onProgress: (Float?) -> Unit): File = downloads.withLock {
    val url = release.apkUrl ?: error("Esta versão ainda não tem o aplicativo para instalar.")
    val file = apkFile(context, release.version)
    if (file.exists() && explainApk(context, file) == null) return file
    file.delete()
    try {
        withContext(Dispatchers.IO) {
            val conn = open(url, "application/octet-stream")
            try {
                val code = conn.responseCode
                if (code !in 200..299) error("O download falhou ($code).")
                val total = conn.contentLengthLong
                var read = 0L
                var lastPercent = -1
                conn.inputStream.use { input ->
                    file.outputStream().use { out ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            read += n
                            val percent = if (total > 0) ((read * 100) / total).toInt() else -1
                            if (percent != lastPercent) {
                                lastPercent = percent
                                withContext(Dispatchers.Main) { onProgress(if (total > 0) read.toFloat() / total else null) }
                            }
                        }
                    }
                }
            } finally {
                conn.disconnect()
            }
        }
    } catch (e: CancellationException) {
        file.delete()
        throw e
    } catch (e: Throwable) {
        file.delete()
        throw e
    }
    explainApk(context, file)?.let { problem ->
        file.delete()
        error(problem)
    }
    return file
}

/**
 * Abre o instalador do Android. Se o aparelho ainda não deixa este app instalar, abre a
 * autorização e devolve o aviso para a tela.
 */
fun startInstall(context: Context, file: File): String? {
    if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
        val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(settings)
        return "Autorize a instalação do Gestor e toque em Atualizar de novo."
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = android.content.ClipData.newRawUri("", uri)
    }
    context.startActivity(intent)
    return null
}
