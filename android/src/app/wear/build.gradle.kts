plugins {
    alias(libs.plugins.application)
    alias(libs.plugins.compose)
}

android {
    namespace = "io.musicfs.android.wear"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.musicfs.android"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.0"
    }
    buildFeatures { compose = true }
    sourceSets.named("main") { kotlin.directories += "../shared/kotlin" }
}

dependencies {
    implementation(project(":connection"))
    implementation(project(":playback"))
    implementation(libs.activity)
    implementation(libs.wear)
    implementation(libs.foundation)
    implementation(libs.viewmodel)
}
