// The TrustWeb APK: androidbrowserhelper's LauncherActivity opens https://app.trustweb.one/ as a Trusted Web Activity
// (AndroidManifest.xml). Version: -PtwVersionName=0.2.1 -PtwVersionCode=201 from the release workflow (the git tag);
// a local build without them says 0.0.0-dev. Signing: the release keystore comes from the environment only
// (ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD; scripts/android_keystore.sh
// makes them); without them the release build is unsigned (fine for a look, not installable on a phone).
plugins {
    id("com.android.application")
}

val twVersionName: String = (project.findProperty("twVersionName") as String?) ?: "0.0.0-dev"
val twVersionCode: Int = ((project.findProperty("twVersionCode") as String?) ?: "1").toInt()
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "one.trustweb.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "one.trustweb.app"
        minSdk = 26
        targetSdk = 35
        versionCode = twVersionCode
        versionName = twVersionName
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "trustweb"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.2")
}
