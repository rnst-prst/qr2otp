const protobuf = require('protobufjs');
const base32 = require('hi-base32');
const fs = require('node:fs');
const path = require('node:path');

const help = `Usage: otp-codes.sh [--uri INDEX] QR_IMAGE...
       node index.js [--uri INDEX] < migration-uris.txt

Default: list accounts without secrets. --uri exports one otpauth URI.
Supply every QR of a multi-part export together. Indexes start at 1.
`;

function fail(message) { throw new Error(message); }

function decodeInput(input) {
    const type = protobuf.loadSync(path.join(__dirname, 'migration-payload.proto'))
        .lookupType('MigrationPayload');
    const lines = input.trim().split(/\r?\n/).filter(line => line.trim());
    if (!input.trim()) fail('No migration URI received.');
    const batches = lines.map(line => {
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
    });
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

function main(args) {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
        process.stdout.write(help);
        return;
    }
    let selected;
    if (args.length) {
        if (args.length !== 2 || args[0] !== '--uri' || !/^[1-9]\d*$/.test(args[1]))
            fail('Usage: node index.js [--uri INDEX]; input is read from stdin.');
        selected = Number(args[1]);
    }
    if (process.stdin.isTTY) fail('Supply QR data through a pipe or stdin file.');
    const accounts = decodeInput(fs.readFileSync(0, 'utf8'));
    if (!accounts.length) fail('Export contains no accounts.');
    const uris = accounts.map(toUri);
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
    try { main(process.argv.slice(2)); }
    catch (error) {
        // Library and filesystem errors may embed input or paths: keep them private.
        const safe = error.code ? 'Unable to read input or load dependencies.' : error.message;
        process.stderr.write(`otp-codes: ${safe}\n`);
        process.exitCode = 1;
    }
}
module.exports = { decodeInput, toUri };
