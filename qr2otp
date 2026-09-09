#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
options=()
usage_error() {
    [[ $# -eq 0 ]] || printf '%s\n\n' "$1" >&2
    node "$script_dir/index.js" --help >&2
    exit 2
}
if [[ $# -eq 0 ]]; then
    usage_error
fi
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
    exec node "$script_dir/index.js" --help
fi
if [[ ${1:-} == --camera || ${1:-} == --camera-save ]]; then
    [[ $# -le 2 && ${2:-/dev/video0} != -* ]] || usage_error 'Expected at most one camera device.'
    command -v zbarcam >/dev/null || { echo 'Install zbar-tools first.' >&2; exit 2; }
    command -v node >/dev/null || { echo 'Install Node.js first.' >&2; exit 2; }
    camera_pid=''
    temp_file=''
    cleanup() {
        if [[ -n $camera_pid ]]; then
            kill "$camera_pid" 2>/dev/null || true
            wait "$camera_pid" 2>/dev/null || true
            camera_pid=''
        fi
        if [[ -n $temp_file ]]; then
            rm -f -- "$temp_file"
        fi
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [[ $1 == --camera-save ]]; then
        runtime_dir=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
        if [[ $runtime_dir != /* || ! -d $runtime_dir ||
              $(stat -c '%u:%a' -- "$runtime_dir") != "$(id -u):700" ||
              $(stat -f -c '%T' -- "$runtime_dir") != tmpfs ]]; then
            echo 'Saving requires a user-owned runtime directory with mode 700 on tmpfs.' >&2
            exit 2
        fi
        temp_file=$(mktemp -- "$runtime_dir/migration-uris.XXXXXXXXXX.txt")
    elif ! ( : <>/dev/tty ) 2>/dev/null; then
        echo 'Camera selection requires a terminal.' >&2
        exit 2
    fi
    echo 'Show every QR from the same export to the camera. Ctrl+C cancels.' >&2
    coproc CAMERA { exec zbarcam --quiet --raw -Sdisable -Sqrcode.enable "${2:-/dev/video0}"; }
    camera_pid=$CAMERA_PID
    camera_fd=${CAMERA[0]}
    if [[ $1 == --camera-save ]]; then
        node "$script_dir/index.js" --scan --migration <&"$camera_fd" >"$temp_file"
        kill "$camera_pid" 2>/dev/null || true
        wait "$camera_pid" 2>/dev/null || true
        camera_pid=''
        printf '%s\n' "$temp_file"
        temp_file=''
    else
        node "$script_dir/index.js" --scan --select <&"$camera_fd"
    fi
    exit
fi
if [[ ${1:-} == --select ]]; then
    options=(--select)
    shift
fi
if [[ ${1:-} == --uri ]]; then
    [[ ${#options[@]} -eq 0 ]] || usage_error 'Choose --select or --uri, not both.'
    [[ ${2:-} =~ ^[1-9][0-9]*$ ]] || usage_error 'Expected --uri INDEX.'
    options=(--uri "$2")
    shift 2
fi
if [[ ${1:-} == -- ]]; then
    shift
elif [[ ${1:-} == -* ]]; then
    usage_error 'Unknown or misplaced option. Use -- before filenames starting with a dash.'
fi
[[ $# -gt 0 ]] || usage_error 'Supply one or more QR image filenames.'
command -v zbarimg >/dev/null || { echo 'Install zbar-tools first.' >&2; exit 2; }
# Decode every image before emitting anything, so failure cannot yield partial output.
if ! qr_data=$(zbarimg --quiet --raw -- "$@"); then
    echo 'QR decoding failed.' >&2
    exit 1
fi
printf '%s\n' "$qr_data" | node "$script_dir/index.js" "${options[@]}"
