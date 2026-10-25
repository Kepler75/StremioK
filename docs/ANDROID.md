# Android build

The Android target packages the existing StremioK HTML interface in a landscape WebView. It
uses the existing HTML5 video fallback; the Tizen AVPlay player and Tizen services are not
part of this target.

## Build a debug APK

Install JDK 17 or newer and Android SDK Platform 36, then set `ANDROID_HOME` or
`ANDROID_SDK_ROOT`. From the repository root:

```bash
gradle -p android exportDebugApk
```

The installable, debug-signed APK is written to `dist/StremioK-android-debug.apk`. For a
standard Gradle build without the export step, use `gradle -p android assembleDebug`.

## Platform differences

- Direct streams use Android WebView's HTML5 video support. Playback formats, codecs, track
  selection and adaptive streaming can differ from Samsung AVPlay.
- The bundled Tizen service is not included. YouTube resolution, service-backed guide data,
  USB indexing and downloads are unavailable in this Android target.
- Tizen app launching, TV remote keys and home-screen previews are not available. Android
  Back follows StremioK's in-app navigation. The phone interface reflows vertically in portrait
  or landscape, with touch scrolling, two-column poster grids and native video transport controls.