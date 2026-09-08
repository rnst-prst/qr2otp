#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
options=()
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
    exec node "$script_dir/index.js" --help
fi
if [[ ${1:-} == --uri ]]; then
    [[ ${2:-} =~ ^[1-9][0-9]*$ ]] || { echo 'Expected --uri INDEX.' >&2; exit 2; }
    options=(--uri "$2")
    shift 2
fi
[[ ${1:-} != -- ]] || shift
[[ $# -gt 0 ]] || { echo 'Supply one or more QR image filenames.' >&2; exit 2; }
command -v zbarimg >/dev/null || { echo 'Install zbar-tools first.' >&2; exit 2; }
# Decode every image before emitting anything, so failure cannot yield partial output.
if ! qr_data=$(zbarimg --quiet --raw -- "$@"); then
    echo 'QR decoding failed.' >&2
    exit 1
fi
printf '%s\n' "$qr_data" | node "$script_dir/index.js" "${options[@]}"
