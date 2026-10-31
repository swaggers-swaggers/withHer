#!/usr/bin/env bash
set -euo pipefail
study_app_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
study_app_binary="$study_app_root/release/linux-unpacked/studydesk"
unset ELECTRON_RUN_AS_NODE CHROME_DEVEL_SANDBOX
mkdir -p -- "$study_app_root/release"
exec >> "$study_app_root/release/launch.log" 2>&1
printf '\n[StudyDesk launcher] %s pid=%s desktop=%s script=%s\n' "$(date --iso-8601=seconds)" "$$" "${GIO_LAUNCHED_DESKTOP_FILE:-direct}" "${BASH_SOURCE[0]}"
if ! study_sandbox_helper="$(bash "$study_app_root/scripts/prepare-sandbox.sh" "$study_app_binary")"; then
  study_error='StudyDesk 启动组件未配置成功，请安装项目 release 目录中的 deb 安装包。'
  if command -v zenity >/dev/null 2>&1; then zenity --error --title=StudyDesk --text="$study_error"; else printf '%s\n' "$study_error" >&2; fi
  exit 1
fi
printf '[StudyDesk launcher] helper=%s target=%s owner:mode=%s\n' "$study_sandbox_helper" "$(readlink -f -- "$study_sandbox_helper")" "$(stat -Lc '%u:%a' -- "$study_sandbox_helper")"
exec "$study_app_binary" "$@"
