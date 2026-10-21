import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, assemble, publish } from '../package-files.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfs-package-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('musicfs-package-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const root = path.join(directory, 'source');
  const output = path.join(directory, 'musicfs-windows-amd64');
  write(path.join(root, 'scripts/launch/start.bat'), '@echo off\r\n');
  write(path.join(root, 'scripts/launch/start.sh'), '#!/bin/sh\n');
  write(path.join(root, 'docs/packaging-start.md'), 'Startup instructions\n');
  function stage(version = 'one', platform = 'windows', extra = {}) {
    const target = path.join(directory, '.' + path.basename(output) + '.build-' + crypto.randomUUID());
    const contents = {
      'release.json': JSON.stringify({ os: platform, arch: 'amd64', version }),
      ['bin/musicfs' + (platform === 'windows' ? '.exe' : '')]: 'Executable ' + version,
      'web/index.html': '<html>' + version + '</html>',
      ['web/assets/' + version + '.js']: 'Asset ' + version,
      'configs/server.example.yaml': 'example: ' + version + '\n',
      ...extra,
    };
    for (const [name, content] of Object.entries(contents)) write(path.join(target, name), content);
    assemble(target, root, platform, 'revision-' + version, 'true', 'true');
    return target;
  }
  return { directory, root, output, stage };
}

function tree(directory) {
  const result = {};
  function visit(current, prefix = '') {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const relative = prefix + name;
      const info = fs.lstatSync(file);
      if (info.isSymbolicLink()) result[relative] = 'link:' + fs.readlinkSync(file);
      else if (info.isDirectory()) visit(file, relative + '/');
      else result[relative] = fs.readFileSync(file).toString('base64');
    }
  }
  visit(directory);
  return result;
}

function verifyManifest(directory) {
  const entries = check(directory);
  assert.ok(entries.size > 0);
  for (const [name, expected] of entries) {
    assert.equal(digest(fs.readFileSync(path.join(directory, name))), expected, name);
  }
  return entries;
}

function changeManifest(directory, transform) {
  const file = path.join(directory, 'SHA256SUMS');
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
}

test('two builds replace managed files and preserve all runtime files', t => {
  const { output, stage } = fixture(t);
  const first = stage();
  publish(first, output);
  assert.equal(fs.existsSync(first), false);
  const retained = {
    'configs/server.yaml': 'custom: settings\n',
    'configs/admin-token.txt': 'test-token\n',
    'data/library.db': Buffer.from([0, 2, 255, 4]),
    'music/user-track.flac': 'User content',
    'notes.txt': 'User notes',
    'web/user-extra.txt': 'Unregistered extra file',
  };
  for (const [name, content] of Object.entries(retained)) write(path.join(output, name), content);
  const second = stage('two');
  publish(second, output);
  assert.equal(fs.existsSync(second), false);
  assert.equal(fs.existsSync(output + '.update-lock'), false);
  assert.equal(fs.existsSync(path.join(output, '.incomplete')), false);
  assert.equal(fs.existsSync(path.join(output, 'web/assets/one.js')), false);
  assert.equal(fs.readFileSync(path.join(output, 'web/assets/two.js'), 'utf8'), 'Asset two');
  assert.equal(fs.readFileSync(path.join(output, 'bin/musicfs.exe'), 'utf8'), 'Executable two');
  assert.equal(fs.readFileSync(path.join(output, 'configs/server.example.yaml'), 'utf8'), 'example: two\n');
  for (const [name, content] of Object.entries(retained)) {
    assert.deepEqual(fs.readFileSync(path.join(output, name)), Buffer.from(content), name);
  }
  const entries = verifyManifest(output);
  for (const name of Object.keys(retained)) assert.equal(entries.has(name), false, name);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'web-source.json'))), {
    webRevision: 'revision-two', webDirty: true, webRebuilt: true,
  });
});

test('a fingerprint reference move updates old installations without touching nearby files', t => {
  const { output, stage } = fixture(t);
  const previous = 'src/identification/fingerprint/REFERENCES.md';
  const current = 'src/metadata/identification/fingerprint/REFERENCES.md';
  publish(stage('one', 'windows', { [previous]: 'Previous algorithm references' }), output);
  const notes = path.join(output, 'src/identification/fingerprint/notes.txt');
  write(notes, 'Personal notes');
  publish(stage('two', 'windows', { [current]: 'Current algorithm references' }), output);
  const entries = verifyManifest(output);
  assert.equal(entries.has(previous), false);
  assert.equal(entries.has(current), true);
  assert.equal(fs.existsSync(path.join(output, previous)), false);
  assert.equal(fs.readFileSync(path.join(output, current), 'utf8'), 'Current algorithm references');
  assert.equal(fs.readFileSync(notes, 'utf8'), 'Personal notes');
  assert.equal(fs.existsSync(path.join(output, '.incomplete')), false);
});

test('a case-only asset rename preserves the new file and removes distinct old files', t => {
  const { output, stage } = fixture(t);
  publish(stage('one', 'windows', { 'web/Logo.svg': 'Old logo' }), output);
  const caseSensitive = !fs.existsSync(path.join(output, 'web/logo.svg'));
  publish(stage('two', 'windows', { 'web/logo.svg': 'New logo' }), output);
  assert.equal(fs.readFileSync(path.join(output, 'web/logo.svg'), 'utf8'), 'New logo');
  if (caseSensitive) assert.equal(fs.existsSync(path.join(output, 'web/Logo.svg')), false);
  const entries = verifyManifest(output);
  assert.equal(entries.has('web/Logo.svg'), false);
  assert.equal(entries.has('web/logo.svg'), true);
  assert.equal(fs.existsSync(path.join(output, '.incomplete')), false);
});

test('an interrupted case-only rename recovers without accepting exact duplicate paths', t => {
  const { output, stage } = fixture(t);
  publish(stage('one', 'windows', { 'web/Logo.svg': 'Old logo' }), output);
  const caseSensitive = !fs.existsSync(path.join(output, 'web/logo.svg'));
  write(path.join(output, '.incomplete'), 'Interrupted update');
  write(path.join(output, 'web/logo.svg'), 'Partial logo');
  changeManifest(output, value => value + digest('Partial logo') + '  web/logo.svg\n');
  const manifestFile = path.join(output, 'SHA256SUMS');
  const recoveryManifest = fs.readFileSync(manifestFile, 'utf8');
  changeManifest(output, value => value + digest('Partial logo') + '  web/logo.svg\n');
  assert.throws(() => check(output), /Duplicate build path/);
  fs.writeFileSync(manifestFile, recoveryManifest);
  publish(stage('recovered', 'windows', { 'web/logo.svg': 'Recovered logo' }), output);
  assert.equal(fs.readFileSync(path.join(output, 'web/logo.svg'), 'utf8'), 'Recovered logo');
  if (caseSensitive) assert.equal(fs.existsSync(path.join(output, 'web/Logo.svg')), false);
  verifyManifest(output);
  assert.equal(fs.existsSync(path.join(output, '.incomplete')), false);
});

test('an empty output is accepted and assembled Linux launcher is executable', t => {
  const { output, stage } = fixture(t);
  fs.mkdirSync(output);
  assert.equal(check(output).size, 0);
  publish(stage('linux', 'linux'), output);
  const entries = verifyManifest(output);
  assert.ok(entries.has('start.sh'));
  assert.equal(entries.has('start.bat'), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(output, 'start.sh')).mode & 0o777, 0o755);
});

test('a corrupt staged file never changes the existing runnable directory', t => {
  const { output, stage } = fixture(t);
  publish(stage(), output);
  const before = tree(output);
  const next = stage('two');
  write(path.join(next, 'bin/musicfs.exe'), 'Corruption after hashing');
  assert.throws(() => publish(next, output), /checksum mismatch/);
  assert.deepEqual(tree(output), before);
  assert.equal(fs.existsSync(next), true);
});

test('an incomplete or unlisted staged build never changes existing output', t => {
  const { output, stage } = fixture(t);
  publish(stage(), output);
  const before = tree(output);
  const next = stage('two');
  write(path.join(next, '.incomplete'), 'Interrupted');
  assert.throws(() => publish(next, output), /incomplete/);
  assert.deepEqual(tree(output), before);
  fs.unlinkSync(path.join(next, '.incomplete'));
  write(path.join(next, 'web/unlisted.js'), 'Unlisted');
  assert.throws(() => publish(next, output), /unlisted/);
  assert.deepEqual(tree(output), before);
});

for (const name of ['../outside.txt', 'web/../../outside.txt', 'web\\outside.txt', 'web/C:outside',
  '/web/absolute.txt', 'web/trailing.', 'configs/server.yaml', 'configs/admin-token.txt', 'data/library.db']) {
  test('rejects unsafe or runtime manifest entry: ' + name, t => {
    const { output, stage } = fixture(t);
    publish(stage(), output);
    changeManifest(output, value => value + digest('unused') + '  ' + name + '\n');
    const before = tree(output);
    assert.throws(() => check(output), /Invalid build path|Unmanaged build path/);
    assert.throws(() => publish(stage('two'), output), /Invalid build path|Unmanaged build path/);
    assert.deepEqual(tree(output), before);
  });
}

test('rejects malformed, duplicate, or incomplete manifest entries', t => {
  const { output, stage } = fixture(t);
  publish(stage(), output);
  const file = path.join(output, 'SHA256SUMS');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, 'not a checksum\n');
  assert.throws(() => check(output), /Invalid build manifest/);
  fs.writeFileSync(file, original + digest('unused') + '  WEB/index.html\n');
  assert.throws(() => check(output), /Unmanaged build path|Duplicate build path/);
  fs.writeFileSync(file, original + digest('unused') + '  web/INDEX.html\n');
  assert.throws(() => check(output), /Duplicate build path/);
  fs.writeFileSync(file, original.split('\n').filter(line => !line.endsWith('  release.json')).join('\n'));
  assert.throws(() => check(output), /missing release.json/);
});

test('rejects a managed output hard link before touching its target', t => {
  const { directory, output, stage } = fixture(t);
  publish(stage(), output);
  const external = path.join(directory, 'external.txt');
  write(external, 'Protected file');
  const linked = path.join(output, 'web/index.html');
  fs.unlinkSync(linked);
  fs.linkSync(external, linked);
  const before = tree(output);
  assert.throws(() => publish(stage('two'), output), /Hard links are not allowed/);
  assert.equal(fs.readFileSync(external, 'utf8'), 'Protected file');
  assert.deepEqual(tree(output), before);
});

test('rejects a staged directory link before following it', t => {
  const { directory, output, stage } = fixture(t);
  publish(stage(), output);
  const before = tree(output);
  const external = path.join(directory, 'external-web');
  write(path.join(external, 'index.html'), 'Protected content');
  const next = stage('two');
  const linked = path.join(next, 'licenses');
  fs.symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => publish(next, output), /Links are not allowed/);
  assert.deepEqual(tree(output), before);
  assert.equal(fs.readFileSync(path.join(external, 'index.html'), 'utf8'), 'Protected content');
});

test('rejects platform mismatch without changing the current package', t => {
  const { output, stage } = fixture(t);
  publish(stage(), output);
  const before = tree(output);
  assert.throws(() => publish(stage('two', 'linux'), output), /different platform/);
  assert.deepEqual(tree(output), before);
});

test('recovers an interrupted update and removes partially copied assets', t => {
  const { output, stage } = fixture(t);
  publish(stage(), output);
  write(path.join(output, '.incomplete'), 'Interrupted update');
  write(path.join(output, 'web/assets/partial.js'), 'Partially copied');
  write(path.join(output, 'bin/musicfs.exe'), 'Partial executable');
  changeManifest(output, value => value + digest('Partially copied') + '  web/assets/partial.js\n');
  write(path.join(output, 'data/library.db'), 'User database');
  publish(stage('recovered'), output);
  assert.equal(fs.existsSync(path.join(output, '.incomplete')), false);
  assert.equal(fs.existsSync(path.join(output, 'web/assets/partial.js')), false);
  assert.equal(fs.existsSync(path.join(output, 'web/assets/one.js')), false);
  assert.equal(fs.readFileSync(path.join(output, 'data/library.db'), 'utf8'), 'User database');
  verifyManifest(output);
});

test('refuses arbitrary output contents, unsafe stage location, and active update lock', t => {
  const { directory, output, stage } = fixture(t);
  write(path.join(output, 'important.txt'), 'Preserve me');
  assert.throws(() => check(output), /regular build file/);
  assert.equal(fs.readFileSync(path.join(output, 'important.txt'), 'utf8'), 'Preserve me');
  fs.unlinkSync(path.join(output, 'important.txt'));
  publish(stage(), output);
  const before = tree(output);
  assert.throws(() => publish(path.join(directory, 'unexpected'), output), /unique sibling/);
  fs.mkdirSync(output + '.update-lock');
  assert.throws(() => publish(stage('two'), output), /Another update is active/);
  assert.deepEqual(tree(output), before);
});
