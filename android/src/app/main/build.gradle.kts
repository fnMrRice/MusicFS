plugins {
    alias(libs.plugins.application)
    alias(libs.plugins.compose)
}

android {
    namespace = "io.musicfs.android.main"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.musicfs.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { compose = true }
    sourceSets.named("main") { kotlin.directories += "../shared/kotlin" }
}

dependencies {
    implementation(project(":connection"))
    implementation(project(":playback"))
    implementation(libs.activity)
    implementation(libs.material)
    implementation(libs.foundation)
    implementation(libs.viewmodel)
}
