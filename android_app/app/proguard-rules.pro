# Recursos Cockpit ProGuard rules
-keepattributes *Annotation*
-dontwarn javax.annotation.**
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
