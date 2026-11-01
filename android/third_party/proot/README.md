# proot

`app/src/main/jniLibs/arm64-v8a/libproot.so` and `libproot-loader.so` are `root/bin/proot` and
`root/libexec/proot/loader` from `proot-android-aarch64.tar.gz` in
[green-green-avk/build-proot-android](https://github.com/green-green-avk/build-proot-android/tree/master/packages)
(statically linked with libtalloc, loader unbundled), built from
[green-green-avk/proot](https://github.com/green-green-avk/proot).

They are named `lib*.so` so Android installs them into the app's native library folder, the one
place an app targeting Android 10+ may execute its own binaries from.

PRoot is licensed under the GNU General Public License, version 2; its source is at the links above.
