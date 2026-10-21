plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val appVersion = groovy.json.JsonSlurper().parse(rootProject.file("../version.json")) as Map<*, *>
val appVersionName = appVersion["version"] as String
val appVersionCode = (appVersion["code"] as Number).toInt()

android {
    namespace = "com.victor.gestor"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.victor.gestor"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

val webDest = layout.projectDirectory.dir("src/main/assets/www")

val buildWeb = tasks.register<Exec>("buildWeb") {
    workingDir = rootProject.projectDir.parentFile
    commandLine("cmd", "/c", "npm", "--prefix", "client", "run", "build:mobile")
}

val copyWeb = tasks.register<Copy>("copyWeb") {
    dependsOn(buildWeb)
    from(rootProject.file("../client/dist-mobile"))
    into(webDest)
    doFirst { project.delete(webDest) }
}

tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
