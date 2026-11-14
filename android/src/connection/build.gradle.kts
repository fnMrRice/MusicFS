plugins {
    alias(libs.plugins.library)
}

android {
    namespace = "io.musicfs.android.connection"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
}

androidComponents {
    onVariants { variant ->
        variant.androidTest?.sources?.kotlin?.addStaticSourceDirectory("../../tests/connection/androidTest")
        variant.hostTests[com.android.build.api.variant.HostTestBuilder.UNIT_TEST_TYPE]
            ?.sources?.kotlin?.addStaticSourceDirectory("../../tests/connection/unit")
    }
}
dependencies {
    api(libs.okhttp)
    api(libs.viewmodel)
    api(libs.coroutines)
    androidTestImplementation(libs.android.test.runner)
    androidTestImplementation(libs.android.test.junit)
    testImplementation("junit:junit:4.13.2")
}
