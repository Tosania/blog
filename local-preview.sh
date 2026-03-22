#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

choice="${1:-}"

if [[ -z "$choice" ]]; then
  echo "请选择启动模式:"
  echo "  1) 网页预览 (Astro dev)"
  echo "  2) 编辑页面预览 (Post Studio)"
  read -r -p "输入 1 或 2: " choice
fi

case "$choice" in
  1)
    echo "正在启动网页预览..."
    echo "访问地址: http://127.0.0.1:4321/"
    npm run dev -- --host 127.0.0.1 --port 4321
    ;;
  2)
    echo "正在启动编辑页面预览..."
    echo "访问地址: http://127.0.0.1:4312/"
    npm run post-studio
    ;;
  *)
    echo "无效输入: $choice"
    echo "请重新运行脚本并输入 1 或 2。"
    exit 1
    ;;
esac
