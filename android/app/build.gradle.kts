plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release workflow passes the sestudio release (-PsestudioVersion=1.2.0); one
// version for both halves. 1.2.0 becomes versionCode 10200.
val sestudioVersion = (findProperty("sestudioVersion") as String?) ?: "0.0.1"
val keystore: String? = System.getenv("ANDROID_KEYSTORE")

android {
    namespace = "io.github.dsestu.sestudio"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.dsestu.sestudio"
        minSdk = 26
        targetSdk = 35
        versionName = sestudioVersion
        versionCode = sestudioVersion.split(".").map(String::toInt).let { (major, minor, patch) ->
            major * 10000 + minor * 100 + patch
        }
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") } // the ABIs proot is bundled for
    }

    // Every release is signed with the same key, or Android refuses it as an update.
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = "sestudio"
                keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // proot must exist as a real file in nativeLibraryDir to be executed.
    packaging { jniLibs { useLegacyPackaging = true } }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("org.apache.commons:commons-compress:1.27.1")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
