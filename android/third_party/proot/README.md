# proot

`app/src/main/jniLibs/<abi>/` holds, for `arm64-v8a`, `armeabi-v7a` and `x86_64`, Termux's builds
(Termux arches `aarch64`, `arm`, `x86_64`) from
[packages.termux.dev](https://packages.termux.dev/apt/termux-main/pool/main/):

| File | From |
|---|---|
| `libproot.so` | `bin/proot` in `proot_5.1.107.102` |
| `libproot-loader.so` | `libexec/proot/loader` in `proot_5.1.107.102` |
| `libtalloc.so` | `lib/libtalloc.so.2.5.0` in `libtalloc_2.5.0` |
| `libandroid-shmem.so` | `lib/libandroid-shmem.so` in `libandroid-shmem_0.7` |

Termux builds its 64-bit packages with 16 KB pages, which Android 15+ devices may run. They are
named `lib*.so` so Android installs them into the app's native library folder, the one place an
app targeting Android 10+ may execute its own binaries from. Patched with patchelf
(`--page-size 16384`): Termux's RUNPATH removed, and `libtalloc.so.2` renamed `libtalloc.so`
(NEEDED in proot, SONAME in talloc), since Android only installs `lib*.so` files.
`Runtime.kt` points `LD_LIBRARY_PATH` at that folder.

PRoot is licensed under the GNU General Public License, version 2 (source:
[termux/proot](https://github.com/termux/proot)); talloc under the GNU LGPL, version 3;
libandroid-shmem under the BSD 3-clause license
([termux/libandroid-shmem](https://github.com/termux/libandroid-shmem)).
