#!/usr/bin/env bash
set -euo pipefail
study_executable="${1:?需要应用可执行文件路径}"
study_runtime_dir="$(cd -- "$(dirname -- "$study_executable")" && pwd)"
study_local_helper="$study_runtime_dir/chrome-sandbox"
study_valid_helper() {
  [ -f "$1" ] && [ -x "$1" ] && [ "$(stat -Lc '%u:%a' -- "$1")" = '0:4755' ]
}
if study_valid_helper "$study_local_helper"; then
  printf '%s\n' "$study_local_helper"
  exit 0
fi
study_system_helper=/opt/google/chrome/chrome-sandbox
if ! study_valid_helper "$study_system_helper"; then
  printf '%s\n' '未找到配置正确的启动组件，请安装 StudyDesk 的 deb 安装包。' >&2
  exit 1
fi
# Chromium 优先读取相邻文件；仅设置 CHROME_DEVEL_SANDBOX 无法覆盖它。
# 保留随包的原件供 deb 使用，本机相邻路径指向系统已有的标准组件。
if [ -f "$study_local_helper" ] && [ ! -L "$study_local_helper" ]; then
  if [ ! -e "$study_runtime_dir/chrome-sandbox.bundled" ]; then
    cp -- "$study_local_helper" "$study_runtime_dir/chrome-sandbox.bundled"
  fi
fi
study_helper_tmp="$study_runtime_dir/.chrome-sandbox.$$"
trap 'rm -f -- "$study_helper_tmp"' EXIT
ln -s -- "$study_system_helper" "$study_helper_tmp"
mv -Tf -- "$study_helper_tmp" "$study_local_helper"
study_valid_helper "$study_local_helper"
printf '%s\n' "$study_local_helper"
