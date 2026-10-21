package com.victor.gestor.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Releases do próprio repositório do gestor. O celular baixa o APK daqui. */
const val UPDATES_REPO = "VictorCabral99/gestor-financeiro"
const val UPDATES_URL = "https://api.github.com/repos/$UPDATES_REPO/releases?per_page=20"

data class AppRelease(val version: String, val notes: String, val apkUrl: String?)

private val versionPattern = Regex("""v?(\d+)\.(\d+)\.(\d+)""")
private val json = Json { ignoreUnknownKeys = true }

@Serializable
private data class GhRelease(
    @SerialName("tag_name") val tag: String,
    val body: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GhAsset> = emptyList(),
)

@Serializable
private data class GhAsset(
    val name: String = "",
    @SerialName("browser_download_url") val url: String = "",
)

fun parseVersion(raw: String): List<Int>? {
    val match = versionPattern.matchEntire(raw.trim()) ?: return null
    return listOf(match.groupValues[1].toInt(), match.groupValues[2].toInt(), match.groupValues[3].toInt())
}

/** Negativo se `a` for mais antiga que `b`. Null se alguma das duas não for x.y.z. */
fun compareVersions(a: String, b: String): Int? {
    val pa = parseVersion(a) ?: return null
    val pb = parseVersion(b) ?: return null
    for (i in 0..2) if (pa[i] != pb[i]) return if (pa[i] < pb[i]) -1 else 1
    return 0
}

fun parseReleases(raw: String): List<GhView> =
    json.decodeFromString<List<GhRelease>>(raw).map { release ->
        GhView(release.tag, release.body.orEmpty(), release.draft, release.prerelease, release.assets.map { it.name to it.url })
    }

data class GhView(
    val tag: String,
    val notes: String,
    val draft: Boolean,
    val prerelease: Boolean,
    val assets: List<Pair<String, String>>,
)

/** A publicação mais nova, acima da versão instalada. Rascunho e pré-lançamento ficam de fora. */
fun pickUpdate(current: String, releases: List<GhView>): AppRelease? {
    var best: AppRelease? = null
    for (release in releases) {
        val parts = parseVersion(release.tag) ?: continue
        if (release.draft || release.prerelease) continue
        val againstCurrent = compareVersions(release.tag, current) ?: continue
        if (againstCurrent <= 0) continue
        if (best != null && compareVersions(release.tag, best.version) != 1) continue
        val apk = release.assets.firstOrNull { (name, url) -> name.endsWith(".apk", ignoreCase = true) && url.isNotBlank() }
        best = AppRelease(
            version = parts.joinToString("."),
            notes = release.notes.trim().ifEmpty { "Esta versão não descreve o que mudou." },
            apkUrl = apk?.second,
        )
    }
    return best
}
