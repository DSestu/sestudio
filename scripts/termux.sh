#!/data/data/com.termux/files/usr/bin/bash
# Installs sestudio on an Android phone, inside Termux. Run once:
#   curl -fsSL https://raw.githubusercontent.com/DSestu/sestudio/main/scripts/termux.sh | bash
# It runs in Debian (proot-distro), not in Termux itself: there, sestudio's
# dependencies (mini-racer, cryptography, ffmpeg...) have ready-made builds.
set -euo pipefail

# A function, so a piped script is read whole before anything runs and reads stdin.
main() {

  # proot and libandroid-shmem move together: a newer proot-distro with an older
  # proot fails with "cannot locate symbol libandroid_shmdt_fd".
  pkg install -y proot-distro proot libandroid-shmem curl
  [ -d /sdcard/Movies ] || termux-setup-storage

  # Logging in is the check: proot-distro has moved where it keeps containers.
  proot-distro login debian -- true 2>/dev/null || proot-distro install debian

  proot-distro login debian -- bash -c '
  set -e
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates
  [ -x ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh
  mkdir -p ~/.config/sestudio /sdcard/Movies/sestudio
  # A first config: downloads land in the phone'"'"'s Movies folder, and AI frame
  # rates stay off, as the phone'"'"'s GPU is out of reach from here.
  [ -f ~/.config/sestudio/config.json ] ||
    echo "{\"output_root\": \"/sdcard/Movies/sestudio\", \"frame_interpolation\": false}" \
      > ~/.config/sestudio/config.json
  '

  # The home-screen button (Termux:Widget): starts sestudio, then opens it.
  mkdir -p ~/.shortcuts
  cat > ~/.shortcuts/sestudio <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
# The sestudio app shows it borderless; without it, the browser.
(until curl -s -o /dev/null http://localhost:8080; do sleep 1; done
 am start -n io.github.dsestu.sestudio/.MainActivity >/dev/null 2>&1 ||
   termux-open-url http://localhost:8080) &
# only-managed: Termux's own Python is visible inside Debian and reports
# Android, which would make uv build every dependency from source.
exec proot-distro login debian -- env UV_PYTHON_PREFERENCE=only-managed UV_LINK_MODE=copy \
  /root/.local/bin/uvx sestudio@latest
EOF
  chmod +x ~/.shortcuts/sestudio

  echo
  echo "Installed. Add the Termux:Widget widget to your home screen and tap 'sestudio'."
  echo "Or start it now: ~/.shortcuts/sestudio"
}

main
