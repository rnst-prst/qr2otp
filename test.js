const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const protobuf = require('protobufjs');
const { decodeInput, toUri, readScan, chooseAccount } = require('./index');
const { Readable, PassThrough } = require('node:stream');
const type = protobuf.loadSync(path.join(__dirname, 'migration-payload.proto')).lookupType('MigrationPayload');
const account = { secret: Buffer.from('12345678901234567890'), name: 'test+label@example.invalid',
    issuer: 'Example & Co', algorithm: 1, digits: 1, type: 2 };
function payload(fields = {}) {
    const bytes = type.encode(type.fromObject({ version: 1, batchSize: 1,
        batchIndex: 0, batchId: 17, otpParameters: [account], ...fields })).finish();
    return 'otpauth-migration://offline?data=' + encodeURIComponent(Buffer.from(bytes).toString('base64'));
}
test('TOTP preserves label, secret and parameters', () => {
    const uri = new URL(toUri(decodeInput(payload())[0]));
    assert.equal(uri.searchParams.get('secret'), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(uri.searchParams.get('issuer'), account.issuer);
    assert.equal(uri.searchParams.get('digits'), '6');
    assert.equal(uri.searchParams.get('period'), '30');
    assert.equal(decodeURIComponent(uri.pathname.slice(1)), account.issuer + ':' + account.name);
});
test('HOTP preserves 64-bit counter, SHA512 and eight digits', () => {
    const input = payload({ otpParameters: [{ ...account, type: 1, algorithm: 3, digits: 2, counter: '9007199254740993' }] });
    const uri = new URL(toUri(decodeInput(input)[0]));
    assert.equal(uri.hostname, 'hotp');
    assert.equal(uri.searchParams.get('counter'), '9007199254740993');
    assert.equal(uri.searchParams.get('algorithm'), 'SHA512');
    assert.equal(uri.searchParams.get('digits'), '8');
    assert.equal(uri.searchParams.has('period'), false);
});
test('batch completeness, ordering and duplicate rejection', () => {
    const a = payload({ batchSize: 2 });
    const b = payload({ batchSize: 2, batchIndex: 1, otpParameters: [{ ...account, name: 'second' }] });
    assert.throws(() => decodeInput(a), /Incomplete/);
    assert.throws(() => decodeInput(a + '\n' + a), /duplicate/);
    assert.equal(decodeInput(b + '\n' + a)[0].name, account.name);
    assert.throws(() => decodeInput(a + '\n' + payload({ batchSize: 2, batchIndex: 1, batchId: 99 })), /Mixed/);
});
test('malformed inputs and unsupported parameters fail', () => {
    for (const input of ['', 'invalid', 'https://example.invalid', 'otpauth-migration://offline?data=@@'])
        assert.throws(() => decodeInput(input));
    assert.throws(() => toUri({ ...account, algorithm: 4 }), /Unsupported/);
    assert.throws(() => toUri({ ...account, digits: 0 }), /Unsupported/);
});
test('CLI works from another directory and lists without secrets', () => {
    const cli = spawnSync(process.execPath, [path.join(__dirname, 'index.js')], { input: payload(), cwd: '/tmp', encoding: 'utf8', timeout: 3000 });
    assert.equal(cli.status, 0);
    assert.ok(cli.stdout.includes(account.name));
    assert.ok(!cli.stdout.includes('GEZDGNBV'));
    assert.ok(!cli.stdout.includes('otpauth://'));
});
test('CLI selection and errors produce no partial secrets', () => {
    const run = (args, input) => spawnSync(process.execPath, [path.join(__dirname, 'index.js'), ...args], { input, encoding: 'utf8', timeout: 3000 });
    assert.match(run(['--uri', '1'], payload()).stdout, /^otpauth:\/\/totp\//);
    for (const result of [run(['--uri', '2'], payload()), run([], 'not-a-secret-valid-uri')]) {
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.ok(!result.stderr.includes('not-a-secret-valid-uri'));
    }
});

test('live scan completes without EOF, deduplicates and orders QR codes', async () => {
    const input = new PassThrough();
    const messages = [];
    const result = readScan(input, message => messages.push(message));
    const last = payload({ batchSize: 2, batchIndex: 1, otpParameters: [{ ...account, name: 'second' }] });
    input.write(last + '\n' + last + '\n');
    input.write(payload({ batchSize: 2 }) + '\n');
    const accounts = await result;
    assert.deepEqual(accounts.map(otp => otp.name), [account.name, 'second']);
    assert.equal(input.destroyed, true);
    assert.deepEqual(messages, ['QR acquired: 1/2\n', 'QR acquired: 2/2\n']);
});

test('live scan rejects incomplete, mixed, conflicting and malformed exports', async () => {
    const a = payload({ batchSize: 2 });
    for (const lines of [
        [a],
        [a, payload({ batchSize: 2, batchIndex: 1, batchId: 99 })],
        [a, payload({ batchSize: 2, otpParameters: [{ ...account, name: 'changed' }] })],
        ['invalid'],
        [payload({ batchIndex: 1 })]
    ]) {
        await assert.rejects(readScan(Readable.from(lines.map(line => line + '\n')), () => {}));
    }
});

test('interactive selection retries, cancels and never lists secrets', async () => {
    let displayed = '';
    const output = { write: text => { displayed += text; } };
    assert.equal(await chooseAccount([account], ['0', '2', 'invalid', '1'], output), 1);
    assert.ok(displayed.includes(account.name));
    assert.ok(displayed.includes('Invalid selection'));
    assert.ok(!displayed.includes('otpauth://'));
    assert.ok(!displayed.includes('12345678901234567890'));
    await assert.rejects(chooseAccount([account], ['q'], output), /cancelled/);
    await assert.rejects(chooseAccount([account], [], output), /cancelled/);
});

test('saved migration data is complete, ordered and reusable', async () => {
    const first = payload({ batchSize: 2 });
    const last = payload({ batchSize: 2, batchIndex: 1, otpParameters: [{ ...account, name: 'second' }] });
    const saved = await readScan(Readable.from([last + '\n' + last + '\n' + first + '\n']), () => {}, true);
    assert.equal(saved, first + '\n' + last + '\n');
    assert.deepEqual(decodeInput(saved).map(otp => otp.name), [account.name, 'second']);
    for (const input of [payload({ otpParameters: [] }),
        payload({ otpParameters: [{ ...account, algorithm: 4 }] })]) {
        await assert.rejects(readScan(Readable.from([input + '\n']), () => {}, true));
    }
});

test('camera-save returns a private tmpfs file and removes failed captures', t => {
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
    try {
        fs.accessSync(runtime, fs.constants.W_OK);
        if (fs.statfsSync(runtime).type !== 0x01021994) return t.skip('Runtime is not tmpfs');
    } catch { return t.skip('Writable runtime tmpfs unavailable'); }
    const dir = fs.mkdtempSync(path.join(runtime, 'otp-test-'));
    try {
        const camera = path.join(dir, 'zbarcam');
        fs.writeFileSync(camera, '#!/bin/sh\necho $$ > "$XDG_RUNTIME_DIR/camera.pid"\nprintf "%s\\n" "$OTP_TEST_PAYLOAD"\nif [ "$OTP_TEST_EOF" = 1 ]; then exit 1; fi\nexec sleep 20\n', { mode: 0o700 });
        const run = (input, eof = false, directory = dir) => spawnSync('bash',
            [path.join(__dirname, 'otp-codes.sh'), '--camera-save'], {
                cwd: '/tmp', encoding: 'utf8', timeout: 5000,
                env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
                    XDG_RUNTIME_DIR: directory, OTP_TEST_PAYLOAD: input, OTP_TEST_EOF: eof ? '1' : '0' }
            });
        const first = payload({ batchSize: 2 });
        const last = payload({ batchSize: 2, batchIndex: 1, otpParameters: [{ ...account, name: 'second' }] });
        const result = run(last + '\n' + last + '\n' + first);
        assert.equal(result.status, 0, result.stderr);
        const filename = result.stdout.trim();
        assert.equal(path.dirname(filename), dir);
        assert.match(path.basename(filename), /^migration-uris\.[A-Za-z0-9]+\.txt$/);
        assert.equal(result.stdout, filename + '\n');
        assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
        assert.equal(fs.readFileSync(filename, 'utf8'), first + '\n' + last + '\n');
        const cameraPid = Number(fs.readFileSync(path.join(dir, 'camera.pid'), 'utf8'));
        assert.throws(() => process.kill(cameraPid, 0), { code: 'ESRCH' });
        for (const index of ['1', '2']) {
            const imported = spawnSync(process.execPath, [path.join(__dirname, 'index.js'), '--uri', index],
                { input: fs.readFileSync(filename), encoding: 'utf8', timeout: 3000 });
            assert.equal(imported.status, 0);
            assert.match(imported.stdout, /^otpauth:\/\/totp\//);
        }
        fs.unlinkSync(filename);
        for (const input of [first, 'invalid', payload({ otpParameters: [] }),
            first + '\n' + payload({ batchSize: 2, batchIndex: 1, batchId: 99 })]) {
            const failed = run(input, true);
            assert.notEqual(failed.status, 0);
            assert.equal(failed.stdout, '');
            assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('migration-uris.')), []);
        }
        const badRuntime = run(payload(), true, '/tmp');
        assert.notEqual(badRuntime.status, 0);
        assert.equal(badRuntime.stdout, '');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
