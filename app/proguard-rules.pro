# PdfiumAndroid uses JNI; keep its classes and native method bindings.
-keep class io.legere.pdfiumandroid.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
