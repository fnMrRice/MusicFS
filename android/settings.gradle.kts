pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MusicFS Android"
include(":main", ":wear", ":connection", ":playback")
project(":main").projectDir = file("src/app/main")
project(":wear").projectDir = file("src/app/wear")
project(":connection").projectDir = file("src/connection")
project(":playback").projectDir = file("src/playback")
