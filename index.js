const protobuf = require('protobufjs');
const base32 = require('hi-base32');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const help = `Usage:
       qr2otp QR_IMAGE...
       qr2otp --uri INDEX QR_IMAGE...
       qr2otp --select QR_IMAGE...
       qr2otp --camera [DEVICE]
       qr2otp --camera-save [DEVICE]
       qr2otp --help
       node index.js [--uri INDEX | --select] [--scan] < migration-uris.txt

Modes and options:
  QR_IMAGE...       List accounts from QR images without printing secrets.
  --uri INDEX       Export one otpauth URI to stdout. Indexes start at 1.
  --select          List and choose an account on /dev/tty; only its URI goes to stdout.
  --camera          Scan a webcam and choose one account interactively.
  --camera-save     Scan a complete export, save migration URIs on runtime tmpfs,
                    close the webcam and print only the temporary filename.
  DEVICE            Camera device (default /dev/video0).
  --                End options before image filenames starting with a dash.
  -h, --help        Show this complete help.

Decoder stdin:
  node index.js reads migration URIs, one per line, from stdin.
  --uri and --select work with this input too.
  --scan            Read a live stream, ignore repeated QR codes and stop at a
                    complete batch. Omit this option when reading saved files.

Examples (run from the project directory):
  ./qr2otp export.png
  ./qr2otp export-1.png export-2.png
  set -o pipefail
  ./qr2otp --uri 3 export.png | pass otp insert OTP/account
  ./qr2otp --select export.png | pass otp insert OTP/account
  ./qr2otp --camera /dev/video1 | pass otp insert OTP/account

  # Capture once, import multiple accounts, then remove the saved file:
  otp_file=$(./qr2otp --camera-save)
  # Continue only if capture succeeded.
  node index.js < "$otp_file"
  node index.js --uri 1 < "$otp_file" | pass otp insert OTP/first
  node index.js --uri 2 < "$otp_file" | pass otp insert OTP/second
  rm -- "$otp_file"

Supply all QR codes from the same export. Different exports cannot be combined.
Exported URIs and saved migration files contain secrets.
--camera-save requires a user-owned directory with mode 700 on tmpfs:
XDG_RUNTIME_DIR, or /run/user/UID if unset. Files have mode 600; remove after use.
`;

function fail(message) { throw new Error(message); }

function decodeInput(input) {
    const lines = input.trim().split(/\r?\n/).filter(line => line.trim());
    if (!input.trim()) fail('No migration URI received.');
    const batches = lines.map(decodeLine);
    return decodeBatches(batches);
}

function decodeLine(line) {
    const type = protobuf.loadSync(path.join(__dirname, 'migration-payload.proto'))
        .lookupType('MigrationPayload');
    let url;
    try { url = new URL(line.trim()); } catch { fail('Invalid migration URI.'); }
    if (url.protocol !== 'otpauth-migration:' || url.hostname !== 'offline')
        fail('Expected an otpauth-migration://offline URI.');
    const values = url.searchParams.getAll('data');
    const data = values[0];
    if (values.length !== 1 || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
        fail('Invalid base64 payload.');
    const buffer = Buffer.from(data, 'base64');
    if (buffer.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, ''))
        fail('Invalid base64 payload.');
    try {
        return type.toObject(type.decode(buffer), { longs: String, defaults: true });
    } catch { fail('Invalid protobuf payload.'); }
}

function decodeBatches(batches) {
    const first = batches[0];
    if (first.version !== 1) fail('Unsupported export version.');
    if (first.batchSize < 1 || first.batchSize !== batches.length)
        fail('Incomplete export: supply all QR images from the same export.');
    const indexes = new Set();
    for (const batch of batches) {
        if (batch.version !== 1 || batch.batchId !== first.batchId ||
            batch.batchSize !== first.batchSize || batch.batchIndex < 0 ||
            batch.batchIndex >= first.batchSize || indexes.has(batch.batchIndex))
            fail('Mixed or duplicate export batches.');
        indexes.add(batch.batchIndex);
    }
    return batches.sort((a, b) => a.batchIndex - b.batchIndex)
        .flatMap(batch => batch.otpParameters);
}

function toUri(otp) {
    const algorithm = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }[otp.algorithm];
    const digits = { 1: 6, 2: 8 }[otp.digits];
    const kind = { 1: 'hotp', 2: 'totp' }[otp.type];
    if (!algorithm || !digits || !kind || !otp.secret.length || !otp.name)
        fail('Unsupported or incomplete OTP parameters.');
    const params = new URLSearchParams({
        secret: base32.encode(otp.secret).replace(/=+$/, ''),
        algorithm, digits: String(digits)
    });
    const issuer = otp.issuer;
    const label = issuer && !otp.name.startsWith(`${issuer}:`)
        ? `${issuer}:${otp.name}` : otp.name;
    if (issuer) params.set('issuer', issuer);
    if (kind === 'hotp') {
        if (!/^\d+$/.test(String(otp.counter))) fail('Invalid HOTP counter.');
        params.set('counter', String(otp.counter));
    } else params.set('period', '30');
    return `otpauth://${kind}/${encodeURIComponent(label)}?${params}`;
}

async function main(args) {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
        process.stdout.write(help);
        return;
    }
    const scan = args.includes('--scan');
    if (scan) args = args.filter(arg => arg !== '--scan');
    if (scan && args.length === 1 && args[0] === '--migration') {
        const migration = await readScan(process.stdin, undefined, true);
        process.stdout.write(migration);
        return;
    }
    const interactive = args.length === 1 && args[0] === '--select';
    if (interactive) args = [];
    let selected;
    if (args.length) {
        if (args.length !== 2 || args[0] !== '--uri' || !/^[1-9]\d*$/.test(args[1]))
            fail('Usage: node index.js [--uri INDEX | --select] [--scan]; input is read from stdin.');
        selected = Number(args[1]);
    }
    if (process.stdin.isTTY) fail('Supply QR data through a pipe or stdin file.');
    const accounts = scan ? await readScan(process.stdin)
        : decodeInput(fs.readFileSync(0, 'utf8'));
    if (!accounts.length) fail('Export contains no accounts.');
    const uris = accounts.map(toUri);
    if (interactive) selected = await selectAccount(accounts);
    if (selected !== undefined) {
        if (selected > accounts.length) fail('Account index is out of range.');
        process.stdout.write(uris[selected - 1] + '\n');
    } else {
        accounts.forEach((otp, i) => {
            process.stdout.write(`${i + 1}\t${JSON.stringify(otp.issuer)}\t${JSON.stringify(otp.name)}\n`);
        });
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        // Library and filesystem errors may embed input or paths: keep them private.
        const safe = error.code ? 'Unable to read input or load dependencies.' : error.message;
        process.stderr.write(`qr2otp: ${safe}\n`);
        process.exitCode = 1;
    });
}
module.exports = { decodeInput, toUri, readScan, chooseAccount };

async function readScan(input, progress = message => process.stderr.write(message), migration = false) {
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const batches = new Map();
    const uris = new Map();
    try {
        for await (const line of lines) {
            if (!line.trim()) continue;
            const batch = decodeLine(line);
            if (batch.version !== 1 || batch.batchSize < 1 || batch.batchIndex < 0 ||
                batch.batchIndex >= batch.batchSize) fail('Invalid export batch.');
            const first = batches.values().next().value;
            if (first && (batch.batchId !== first.batchId || batch.batchSize !== first.batchSize))
                fail('Mixed export batches.');
            const previous = batches.get(batch.batchIndex);
            if (previous) {
                if (JSON.stringify(previous) !== JSON.stringify(batch)) fail('Conflicting duplicate export batch.');
                continue;
            }
            batches.set(batch.batchIndex, batch);
            if (migration) uris.set(batch.batchIndex, line.trim());
            progress(`QR acquired: ${batches.size}/${batch.batchSize}\n`);
            if (batches.size === batch.batchSize) {
                const accounts = decodeBatches([...batches.values()]);
                if (!migration) return accounts;
                if (!accounts.length) fail('Export contains no accounts.');
                accounts.forEach(toUri);
                return [...uris.entries()].sort((a, b) => a[0] - b[0])
                    .map(([, uri]) => uri + '\n').join('');
            }
        }
        fail('Incomplete export: camera stopped before all QR codes were received.');
    } finally {
        lines.close();
        input.destroy();
    }
}

async function chooseAccount(accounts, answers, output) {
    accounts.forEach((otp, i) => output.write(
        `${i + 1}\t${JSON.stringify(otp.issuer)}\t${JSON.stringify(otp.name)}\n`));
    output.write('Select account number (q to cancel): ');
    for await (const answer of answers) {
        const value = answer.trim();
        if (value.toLowerCase() === 'q') fail('Selection cancelled.');
        if (/^[1-9]\d*$/.test(value) && Number(value) <= accounts.length) return Number(value);
        output.write('Invalid selection. Enter an account number (q to cancel): ');
    }
    fail('Selection cancelled.');
}

async function selectAccount(accounts) {
    let fd;
    try { fd = fs.openSync('/dev/tty', 'r+'); }
    catch { fail('Interactive selection requires a controlling terminal; use --uri INDEX.'); }
    const output = { write: text => fs.writeSync(fd, text) };
    function* answers() {
        const byte = Buffer.alloc(1);
        let line = '';
        while (fs.readSync(fd, byte, 0, 1, null)) {
            if (byte[0] === 10) { yield line; line = ''; }
            else line += byte.toString('utf8');
        }
    }
    try { return await chooseAccount(accounts, answers(), output); }
    finally { fs.closeSync(fd); }
}
