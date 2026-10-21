package com.victor.gestor

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL

/** Serve a interface nesta origem fixa e encaminha /api para a conta configurada. */
class LocalHost(private val context: Context, private val accountUrl: () -> String) {
    private var server: ServerSocket? = null
    val port: Int = PORT

    fun start() {
        val socket = ServerSocket()
        socket.reuseAddress = true
        socket.bind(InetSocketAddress("127.0.0.1", PORT))
        server = socket
        Thread {
            while (!socket.isClosed) {
                val client = try {
                    socket.accept()
                } catch (_: Exception) {
                    break
                }
                Thread { handle(client) }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true; name = "gestor-host"; start() }
    }

    fun stop() {
        try {
            server?.close()
        } catch (_: Exception) {
        }
    }

    private fun handle(socket: Socket) {
        socket.use { client ->
            try {
                val request = readRequest(client.getInputStream()) ?: return
                if (request.method == "OPTIONS") {
                    write(client, 204, "No Content", emptyList(), ByteArray(0))
                    return
                }
                if (request.path.startsWith("/api")) {
                    proxy(client, request)
                } else {
                    serve(client, request.path)
                }
            } catch (_: Exception) {
                try {
                    write(client, 500, "Error", listOf("Content-Type: application/json; charset=utf-8"), """{"error":"Falha local."}""".toByteArray())
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun proxy(socket: Socket, request: Request) {
        val account = normalizeAccount(accountUrl())
        if (account == null) {
            val body = """{"error":"Informe o endereço da conta."}""".toByteArray()
            write(socket, 503, "Unavailable", listOf("Content-Type: application/json; charset=utf-8"), body)
            return
        }
        val conn = URL(account + request.target).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = request.method
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.doInput = true
            conn.setRequestProperty("User-Agent", "Gestor")
            request.headers["content-type"]?.let { conn.setRequestProperty("Content-Type", it) }
            request.headers["accept"]?.let { conn.setRequestProperty("Accept", it) }
            request.headers["cookie"]?.let { conn.setRequestProperty("Cookie", it) }
            request.headers["x-profile-id"]?.let { conn.setRequestProperty("X-Profile-Id", it) }
            if (request.body.isNotEmpty()) {
                conn.doOutput = true
                conn.outputStream.use { it.write(request.body) }
            }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
            val headers = mutableListOf<String>()
            conn.contentType?.let { headers += "Content-Type: $it" }
            val cookies = conn.headerFields.entries
                .filter { (key, _) -> key != null && key.equals("Set-Cookie", ignoreCase = true) }
                .flatMap { it.value }
            for (cookie in cookies) headers += "Set-Cookie: ${rewriteCookie(cookie)}"
            write(socket, code, reason(code), headers, bytes)
        } catch (_: Exception) {
            val body = """{"error":"Sem conexão com a conta."}""".toByteArray()
            write(socket, 502, "Bad Gateway", listOf("Content-Type: application/json; charset=utf-8"), body)
        } finally {
            conn.disconnect()
        }
    }

    private fun serve(socket: Socket, path: String) {
        if (path.split("/").any { it == ".." }) {
            write(socket, 400, "Bad Request", emptyList(), ByteArray(0))
            return
        }
        val relative = path.trimStart('/').ifEmpty { "index.html" }
        val asset = openAsset(relative)
        val (name, bytes) = if (asset != null) {
            relative to asset
        } else if (!relative.startsWith("assets/")) {
            "index.html" to (openAsset("index.html") ?: ByteArray(0))
        } else {
            write(socket, 404, "Not Found", emptyList(), ByteArray(0))
            return
        }
        val body = if (name == "index.html") injectShell(bytes) else bytes
        write(socket, 200, "OK", listOf("Content-Type: ${mime(name)}", "Cache-Control: no-cache"), body)
    }

    private fun openAsset(relative: String): ByteArray? = try {
        context.assets.open("www/$relative").use { it.readBytes() }
    } catch (_: Exception) {
        null
    }

    private fun injectShell(bytes: ByteArray): ByteArray {
        val html = bytes.toString(Charsets.UTF_8)
        val marked = html.replace(
            "<head>",
            "<head><script>window.__GESTOR_SHELL=true;document.documentElement.classList.add('shell')</script>",
        )
        return marked.toByteArray(Charsets.UTF_8)
    }

    private fun mime(name: String): String = when {
        name.endsWith(".html") -> "text/html; charset=utf-8"
        name.endsWith(".js") || name.endsWith(".mjs") -> "text/javascript; charset=utf-8"
        name.endsWith(".css") -> "text/css; charset=utf-8"
        name.endsWith(".json") || name.endsWith(".webmanifest") -> "application/json"
        name.endsWith(".svg") -> "image/svg+xml"
        name.endsWith(".png") -> "image/png"
        name.endsWith(".ico") -> "image/x-icon"
        name.endsWith(".woff2") -> "font/woff2"
        else -> "application/octet-stream"
    }

    private data class Request(val method: String, val target: String, val path: String, val headers: Map<String, String>, val body: ByteArray)

    private fun readRequest(input: InputStream): Request? {
        val header = ByteArrayOutputStream()
        while (!header.toString(Charsets.ISO_8859_1).endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0) return null
            header.write(b)
            if (header.size() > 64 * 1024) return null
        }
        val lines = header.toString(Charsets.ISO_8859_1).split("\r\n")
        val parts = lines.firstOrNull()?.split(" ") ?: return null
        if (parts.size < 2) return null
        val headers = mutableMapOf<String, String>()
        for (line in lines.drop(1)) {
            val cut = line.indexOf(':')
            if (cut > 0) headers[line.substring(0, cut).trim().lowercase()] = line.substring(cut + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length > 20 * 1024 * 1024) return null
        val body = ByteArray(length)
        var got = 0
        while (got < length) {
            val n = input.read(body, got, length - got)
            if (n < 0) break
            got += n
        }
        val target = parts[1]
        val path = target.substringBefore('?')
        return Request(parts[0], target, path, headers, body)
    }

    private fun write(socket: Socket, status: Int, reason: String, headers: List<String>, body: ByteArray) {
        val head = buildString {
            append("HTTP/1.1 $status $reason\r\n")
            append("Content-Length: ${body.size}\r\n")
            append("Connection: close\r\n")
            for (header in headers) append(header).append("\r\n")
            append("\r\n")
        }
        val out = socket.getOutputStream()
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    companion object {
        const val PORT = 54731

        fun normalizeAccount(raw: String): String? {
            val trimmed = raw.trim().trimEnd('/')
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null
            return try {
                val url = URL(trimmed)
                if (url.host.isNullOrBlank()) null else trimmed
            } catch (_: Exception) {
                null
            }
        }

        fun rewriteCookie(raw: String): String {
            val kept = raw.split(";").map { it.trim() }.filter { it.isNotEmpty() }.mapNotNull { part ->
                val name = part.substringBefore("=").trim().lowercase()
                when (name) {
                    "domain", "secure" -> null
                    "samesite" -> "SameSite=Lax"
                    else -> part
                }
            }
            return kept.joinToString("; ")
        }

        private fun reason(code: Int): String = when (code) {
            200 -> "OK"
            201 -> "Created"
            204 -> "No Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            409 -> "Conflict"
            429 -> "Too Many Requests"
            500 -> "Error"
            502 -> "Bad Gateway"
            503 -> "Unavailable"
            else -> "OK"
        }
    }
}
