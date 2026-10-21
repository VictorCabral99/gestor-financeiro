package com.victor.gestor.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppUpdateTest {
    private fun release(
        tag: String,
        notes: String = "Notas de $tag",
        draft: Boolean = false,
        prerelease: Boolean = false,
        apk: Boolean = true,
    ) = GhView(tag, notes, draft, prerelease, if (apk) listOf("Gestor.apk" to "https://example.test/$tag.apk") else emptyList())

    @Test fun comparesByNumber() {
        assertEquals(-1, compareVersions("0.9.0", "0.10.0"))
        assertEquals(0, compareVersions("v0.6.1", "0.6.1"))
        assertEquals(1, compareVersions("0.6.2", "0.6.1"))
        assertNull(compareVersions("beta", "0.6.1"))
    }

    @Test fun picksNewestAboveInstalled() {
        val picked = pickUpdate(
            "0.1.0",
            listOf(
                release("v0.1.0"),
                release("v0.1.1", draft = true),
                release("v0.2.0", prerelease = true),
                release("v0.1.1", notes = "  Barra do celular.  "),
                release("v0.1.2"),
                release("noite"),
            ),
        )
        assertEquals(AppRelease("0.1.2", "Notas de v0.1.2", "https://example.test/v0.1.2.apk"), picked)
    }

    @Test fun skipsInstalledVersion() {
        assertNull(pickUpdate("0.1.0", listOf(release("v0.1.0"))))
    }

    @Test fun readsGithubJson() {
        val raw = """[{"tag_name":"v0.1.1","body":"Conta no celular.","draft":false,"prerelease":false,"assets":[{"name":"Gestor.apk","browser_download_url":"https://example.test/app.apk"}]}]"""
        assertEquals(
            AppRelease("0.1.1", "Conta no celular.", "https://example.test/app.apk"),
            pickUpdate("0.1.0", parseReleases(raw)),
        )
    }
}
