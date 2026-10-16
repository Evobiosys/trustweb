// TrustWeb for Android (wave 11): one module, the Trusted Web Activity wrapper of https://app.trustweb.one/.
// Built by .github/workflows/android-release.yml on a version tag (v0.2.1 ...); locally: `gradle -p android assembleRelease`
// (Gradle 8.11+, JDK 17, an Android SDK with platform 36; no wrapper jar in git).
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
rootProject.name = "trustweb-android"
include(":app")
