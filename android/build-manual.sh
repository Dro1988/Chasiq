#!/bin/bash
# Manual Chasiq Android build (no Gradle: this sandbox blocks Java TCP).
# Pipeline copied from the proven BookShelf/Walkthrough Notes flow:
# aapt2 -> javac -> D8 (build-tools 35) -> zipalign -> apksigner.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HOME/workspace/.tools"
export JAVA_HOME="$TOOLS/jdk/jdk-21.0.12.1+1"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="$TOOLS/android-sdk"
BT="$SDK/build-tools/35.0.0"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
BUILD="$TOOLS/chasiq-build"
KEYSTORE="$TOOLS/chasiq-release.keystore"
KEYPASS_FILE="$TOOLS/chasiq-keystore-pass.txt"
FINAL_APK="$APP_DIR/Chasiq.apk"

rm -rf "$BUILD"
mkdir -p "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

"$BT/aapt2" compile --dir "$APP_DIR/src/main/res" -o "$BUILD/compiled"
mapfile -t FLATS < <(find "$BUILD/compiled" -name '*.flat' | sort)
"$BT/aapt2" link -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP_DIR/src/main/AndroidManifest.xml" \
  --min-sdk-version 26 \
  --target-sdk-version 36 \
  --version-code 5 \
  --version-name 1.0.4 \
  --java "$BUILD/gen" \
  "${FLATS[@]}"

find "$APP_DIR/src/main/java" -name '*.java' > "$BUILD/sources.txt"
find "$BUILD/gen" -name 'R.java' >> "$BUILD/sources.txt"
javac --release 17 -nowarn -cp "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"

"$JAVA_HOME/bin/java" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$ANDROID_JAR" \
  --min-api 26 \
  --output "$BUILD/dex" \
  $(find "$BUILD/classes" -name '*.class' | sort)

cp "$BUILD/base.apk" "$BUILD/app-unsigned.apk"
python3 - "$BUILD" <<'PYEOF'
import sys, zipfile
build = sys.argv[1]
with zipfile.ZipFile(build + "/app-unsigned.apk", "a", zipfile.ZIP_DEFLATED) as z:
    z.write(build + "/dex/classes.dex", "classes.dex")
PYEOF

"$BT/zipalign" -f -p 4 "$BUILD/app-unsigned.apk" "$BUILD/app-aligned.apk"
"$JAVA_HOME/bin/java" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias chasiq \
  --ks-pass "file:$KEYPASS_FILE" \
  --key-pass "file:$KEYPASS_FILE" \
  --out "$FINAL_APK" \
  "$BUILD/app-aligned.apk"
"$JAVA_HOME/bin/java" -jar "$BT/lib/apksigner.jar" verify --verbose --print-certs "$FINAL_APK"
ls -lh "$FINAL_APK"
