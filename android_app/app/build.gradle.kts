plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val canonicalVersionFile = file("../../VERSION")
val canonicalVersion = if (canonicalVersionFile.exists()) {
    canonicalVersionFile.readText().trim().ifEmpty { "12.0.1" }
} else {
    "12.0.1"
}
val verParts = canonicalVersion.split(".").mapNotNull { it.toIntOrNull() }
val computedVersionCode = if (verParts.size >= 3) {
    verParts[0] * 10000 + verParts[1] * 100 + verParts[2]
} else {
    120001
}

android {
    namespace = "com.cminewar.recursoscockpit"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cminewar.recursoscockpit"
        minSdk = 26
        targetSdk = 34
        versionCode = computedVersionCode
        versionName = canonicalVersion

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/recursos-release.jks")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "recursoscockpit"
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "recursos"
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: "recursoscockpit"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseKeystore = file("../keystore/recursos-release.jks")
            if (!releaseKeystore.exists()) {
                throw GradleException("No se encontró el keystore oficial en ${releaseKeystore.absolutePath} para firmar la APK.")
            }
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ""
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
