# Changelog

## Unreleased

- Add `--input-file FILE` to read saved migration URIs through `qr2otp`,
  with `-` for stdin. Use the wrapper in all user-facing import examples.
- Upgrade and pin `protobufjs` to 8.8.0, updating the lockfile and removing
  obsolete transitive dependencies. All 11 tests passed; `npm audit` reported
  no known vulnerabilities on 2026-09-15.
- Add the standard MIT license text and document the original Gist and its
  MIT declaration, preserving attribution to Alexander Hoem Rosbach.
- Translate project documentation and package metadata into English.
- The project and command are named `qr2otp`; the script replaces `otp-codes.sh`.
- `--camera-save` saves a validated batch in a private file on tmpfs,
  closes the webcam, and returns the path for subsequent imports.
- Capture QR codes from a webcam with `--camera`, without intermediate files.
- Collect complete batches from a live stream, ignoring repeated scans.
- Interactive selection with `--select`: display the list and prompt on the
  terminal, and write only the selected URI to stdout.

## Changes made before the repository was created

- The original wrapper displayed the payload and passed it as an argument;
  it now sends the payload to the decoder through stdin without printing it.
- Decoder paths are resolved relative to the scripts, and zbar errors stop
  execution.
- The original decoder validated bytes as though they were a protobuf object
  and discarded OTP parameters. The current decoder reads the payload,
  checks batch completeness, and preserves supported parameters.

At that stage, the existing dependencies were retained; dependency updates
and an audit were deferred. See the Unreleased section for subsequent updates.
