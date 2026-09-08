const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const protobuf = require('protobufjs');
const { decodeInput, toUri } = require('./index');
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
