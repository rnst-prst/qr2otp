# qr2otp — Extract OTP accounts from Google Authenticator

Convert Google Authenticator export QR codes into `otpauth://` URIs for
import into another OTP manager. By default, qr2otp lists accounts without
revealing their secrets. Decoding runs locally using zbarimg, protobufjs
and hi-base32.

## Installation

You need Bash, Node.js 18 or later, npm and zbarimg.
On Debian, run the following from the project directory:

```sh
sudo apt install zbar-tools
npm ci
```

`npm ci` installs the versions pinned in `package-lock.json`. It requires
access to the npm registry unless the dependencies are already cached.
The import examples also require `pass` and its `pass-otp` extension.

## Webcam: import without saving images

On Linux, you can scan the QR code displayed on your phone using a webcam
and `zbarcam`, which is also provided by `zbar-tools`. You need a webcam
accessible to your user, a graphical environment for the preview window,
and an interactive terminal to choose an account.

To import one account, use `--camera` as described below. To import multiple
accounts from a single capture, use `--camera-save`, described in the next
section.

Start an account export in Google Authenticator, then run this on your computer:

```bash
set -o pipefail
./qr2otp --camera | pass otp insert OTP/account
```

The workflow is:

1. The webcam preview opens. Hold the QR code on your phone in front of the camera.
2. If the export contains multiple QR codes, show each one during the same
   session. The terminal reports how many have been captured; repeated scans
   of the same QR code are ignored.
3. Once the batch is complete, a numbered account list appears. You can move
   the phone away: the data is already in memory.
4. Enter the account number and press Enter. Only that account's URI is sent
   to `pass`, using the `OTP/account` entry specified in the command.
5. The program exits and stops the webcam process. Enter `q` to cancel the
   selection, or press Ctrl+C to cancel capture.

You do not need to scan the QR code again after listing accounts. No images,
migration URIs or temporary files are saved: `zbarcam` sends the URIs to the
decoder through stdin. The list and selection prompt use `/dev/tty`, while
stdout contains only the selected URI, keeping other text out of the pipe.

The default camera device is `/dev/video0`. To use another device:

```bash
set -o pipefail
./qr2otp --camera /dev/video1 | pass otp insert OTP/account
```

A `--camera` session exports **one account**. Importing another account in
this mode requires a new session. Running `--camera` without a pipe prints
the selected URI, including its secret, to the terminal. If you close the
webcam before capturing all QR codes, the program fails without exporting
any URI. Invalid QR codes or QR codes from different exports cause an error.

For capture options, see the
[zbarcam manual](https://manpages.debian.org/testing/zbar-tools/zbarcam.1.en.html).

## Webcam: capture once and import multiple accounts

The `--camera-save` option scans every QR code in an export and saves their
migration URIs in a temporary file on tmpfs, one per line. It does not save
images. Once the batch is complete and validated, it **closes the webcam and
prints only the file's absolute path to stdout**. Progress messages go to
stderr, so you can capture the path in a shell variable without extra text.

Capture a batch using the default webcam:

```bash
otp_file=$(./qr2otp --camera-save)
```

Continue only if the command succeeds and `otp_file` contains a path.
To use another webcam, run
`otp_file=$(./qr2otp --camera-save /dev/video1)`.

The webcam is now closed. You can list the accounts in the file and reuse
it for as many imports as needed:

```bash
node index.js < "$otp_file"

set -o pipefail
node index.js --uri 1 < "$otp_file" | pass otp insert OTP/first
node index.js --uri 2 < "$otp_file" | pass otp insert OTP/second
```

To choose from the list for each import, use `--select`:

```bash
set -o pipefail
node index.js --select < "$otp_file" | pass otp insert OTP/another
```

Once you have completed and verified the imports, remove the file:

```bash
rm -- "$otp_file"
unset otp_file
```

The file has a random name, `migration-uris.XXXXXXXXXX.txt`, and mode `600`.
It is created in `$XDG_RUNTIME_DIR`, or `/run/user/$(id -u)` if that variable
is unset. The directory must belong to your user, have mode `700`, and
reside on tmpfs. If these requirements are not met, the command fails; it
does not fall back to `/tmp` or a project directory.

Duplicate scans are removed and the URIs are sorted by their batch index.
On an error or a handled interruption, the provisional file is removed and
no path is returned. After a successful capture, the file remains available
until you remove it or the tmpfs is unmounted. A forced termination that
cannot be handled, such as SIGKILL, may leave the provisional file in the
runtime directory.

The file contains the secrets for the entire export. Tmpfs avoids an ordinary
persistent file, but it can use swap: it does not by itself guarantee that
data never reaches disk. See the
[kernel documentation on tmpfs](https://docs.kernel.org/filesystems/tmpfs.html).

## Import from QR images

This workflow starts with **images of Google Authenticator export QR codes**.
You do not need to create or obtain a `migration-uris.txt` file: the script
reads the images directly.

Data passes through these steps:

```text
Google Authenticator: export accounts
    → QR images saved on your computer
    → qr2otp: zbarimg reads the QR contents
    → index.js: decode accounts
    → account list, or the URI for one selected account
```

### 1. Prepare the images

Start an export in Google Authenticator and select the accounts to transfer.
The export may contain one or more QR codes. Obtain a readable image of
each one and transfer them to your computer. You need the export QR codes,
not the numeric OTP codes normally displayed by the app.

Store the QR images and any files containing secrets in the `private/`
directory, which is excluded from Git:

```sh
mkdir -p private
chmod 700 private
```

Copy the export images into this directory. In the examples, `export.png`
represents an export with one QR code; `export-1.png` and `export-2.png`
represent an export with two QR codes. These are example names: substitute
your actual filenames. Run the following commands from the project directory.

### 2. List accounts

List accounts without revealing their secrets:

```sh
./qr2otp private/export.png
```

If the export contains multiple QR codes, pass all images in the same command:

```sh
./qr2otp private/export-1.png private/export-2.png
```

The script prints one line per account: its number starting at 1, issuer,
and account name. It does not print secrets or OTP codes. Use the number
to choose an account in the next step.

### 3. Import an account into pass

To export only account number 3 from the list directly into `pass`:

```bash
set -o pipefail
./qr2otp --uri 3 private/export.png | pass otp insert OTP/account
```

Replace `3` with the desired account number and `OTP/account` with the entry
name to create in `pass`. Use the same images as in the previous step.
Even when exporting a single account from a batch with multiple QR codes,
you must supply every image:

```bash
set -o pipefail
./qr2otp --uri 3 private/export-1.png private/export-2.png | pass otp insert OTP/account
```

The `--uri` option produces an `otpauth://` URI containing the secret and
parameters the destination manager needs to generate OTP codes. The pipe
(`|`) sends it to `pass otp insert` without saving an intermediate file.
Repeat the command for each account you want to import.

To list accounts and choose a number in a single invocation, use `--select`
instead of `--uri INDEX`:

```bash
set -o pipefail
./qr2otp --select private/export.png | pass otp insert OTP/account
```

The list and selection prompt appear on the terminal; only the selected
URI is sent to `pass`. This mode also accepts multiple images from the same export.

`--uri` writes the secret to stdout: use a pipe or explicitly choose a protected
destination. This mode creates no temporary files, does not pass URIs as
command-line arguments, and makes no network requests. You are responsible
for managing the source images.

For all available options, run `./qr2otp --help`.

## Alternative input: previously extracted migration URIs

This mode reads URIs saved by `--camera-save` or extracted using another tool.
**If you use `qr2otp` with images, you can skip this section.**

Each export QR code contains a string starting with
`otpauth-migration://offline?data=...`. This is a migration URI whose encoded
payload contains account data. It is not yet the individual account's
`otpauth://` URI used for import into the destination manager.

`migration-uris.txt` is simply an example filename for a text file containing
these extracted URIs, **one complete URI per line**. You can create it using
another tool or use the temporary file explicitly generated by `--camera-save`.
If an export contains multiple QR codes, the file must contain the URIs from
all QR codes in that same export.

To list accounts by reading the file directly with the decoder:

```sh
node index.js < private/migration-uris.txt
```

The `<` operator feeds the file contents to the program through stdin.
You can also select an account in this mode:

```bash
set -o pipefail
node index.js --uri 3 < private/migration-uris.txt | pass otp insert OTP/account
```

Replace `--uri 3` with `--select` to choose an account interactively without
reading the file again in a second command. The wrapper uses the decoder's
`--scan` option for live streams: it ignores repeated QR codes and stops
reading when the batch is complete, without waiting for the stream to end.
For saved files, normally omit `--scan` so the decoder validates the entire
input and rejects duplicates as well.

This file contains account secrets, just like the QR images. In the regular
image workflow, `qr2otp` passes extracted URIs directly to `index.js` through
stdin, avoiding the need to save them to disk.

## Compatibility and handling secrets

Multi-part exports must be complete and belong to the same batch; image order
does not matter. Separate exports cannot be combined. SHA1/SHA256/SHA512,
6/8 digits, and HOTP/TOTP parameters are preserved; unrecognized parameters
cause an error. The migration format does not include the TOTP period, so
30 seconds is used. Always compare the result with your phone before deleting
the exports.

The `.gitignore` also excludes common image formats and some export filenames.
It does not protect arbitrarily named files outside `private/`: always review
staged files before committing.

Destination URI format:
[Google Authenticator Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format).

## Development

Run the synthetic tests (no real secrets):

```sh
npm test
```

- `qr2otp`: read QR codes using zbarimg or zbarcam.
- `index.js`: decode accounts, validate batches, and export URIs.
- `migration-payload.proto`: migration payload schema.
- `test.js`: decoder and CLI tests.

Notes on previous fixes are in [CHANGELOG.md](CHANGELOG.md).
The dependency audit on 2026-09-15 reported no known vulnerabilities after
upgrading to `protobufjs` 8.8.0. All 11 synthetic tests passed, including
simulated webcam capture. Real webcam testing remains pending.
Run `npm audit` again before release: advisory data can change over time.

## License and provenance

qr2otp is distributed under the [MIT License](LICENSE).

This project is derived from Alexander Hoem Rosbach's (GitHub: `mapster`)
Gist, [Export Google Authenticator secret OTP-keys](https://gist.github.com/mapster/4b8b9f8f6b92cc1ca58ae5506e0508f7).
The original Gist provides the JavaScript decoder, protobuf schema, shell
wrapper, and npm package metadata on which this project was based.

The Gist's `package.json` explicitly declares `"license": "MIT"`, but the
Gist does not include a standalone `LICENSE` file. The license file in this
repository was added by the qr2otp contributors using the
[standard MIT license text](https://opensource.org/license/mit), based on that
declaration; it was not copied from an upstream license file. It credits the
original author and the contributors to this project. No copyright year is
asserted for the original work because the Gist supplies no copyright notice.

qr2otp adds batch validation, parameter preservation, interactive selection,
webcam capture, temporary exports on tmpfs, and synthetic tests. These changes
are maintained in this repository; the original author is credited for the
source work, not represented as the maintainer of these additions.
