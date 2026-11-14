plugins {
    alias(libs.plugins.library)
    alias(libs.plugins.compose)
}

android {
    namespace = "io.musicfs.android.playback"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":connection"))
    implementation(libs.player)
    implementation(libs.session)
    implementation(libs.mediahttp)
    implementation(libs.okhttp)
    implementation(libs.coroutines)
    implementation(libs.foundation)
}
