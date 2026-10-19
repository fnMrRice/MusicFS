import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const documents = new Set([
  'LICENSE', 'go.mod', 'go.sum', 'README.md', 'START.md', 'release.json',
  'web-source.json', 'start.bat', 'start.sh', 'configs/server.example.yaml',
  'configs/server.schema.json', 'scripts/scan.ps1', 'deploy/Dockerfile',
  'deploy/compose.example.yaml', 'deploy/server.container.example.yaml',
  'deploy/nginx.example.conf', 'src/identification/fingerprint/REFERENCES.md',
]);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Only build-owned paths may be copied or deleted, even with an edited manifest.
function managed(name) {
  if (!name || name.includes('\\') || name.includes(':') || name.startsWith('/') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error('Invalid build path: ' + name);
  }
  if (!documents.has(name) && !/^(bin|web|licenses)\/.+/.test(name)) {
    throw new Error('Unmanaged build path: ' + name);
  }
  return name;
}

function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function noLinks(file) {
  let current = path.resolve(file);
  for (;;) {
    const info = stat(current);
    if (info?.isSymbolicLink()) throw new Error('Links are not allowed in build paths: ' + current);
    if (info?.isFile() && info.nlink > 1) throw new Error('Hard links are not allowed: ' + current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function regular(file, optional = false) {
  noLinks(file);
  const info = stat(file);
  if ((!info && !optional) || (info && !info.isFile())) {
    throw new Error('Expected a regular build file: ' + file);
  }
  return info;
}

function manifest(directory, allowCaseAliases = false) {
  const file = path.join(directory, 'SHA256SUMS');
  regular(file);
  const entries = new Map();
  const seen = new Set();
  for (const line of fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error('Invalid build manifest: ' + file);
    const name = managed(match[2]);
    const identity = allowCaseAliases ? name : name.toLowerCase();
    if (seen.has(identity)) throw new Error('Duplicate build path: ' + name);
    seen.add(identity);
    entries.set(name, match[1]);
  }
  if (!entries.has('release.json')) throw new Error('Build manifest is missing release.json.');
  return entries;
}

function replaceFile(file, write) {
  const temporary = file + '.build-' + crypto.randomUUID();
  try {
    write(temporary);
    fs.renameSync(temporary, file);
  } finally {
    if (stat(temporary)) fs.unlinkSync(temporary);
  }
}

function writeManifest(directory, entries) {
  const lines = [...entries].map(([name, digest]) => digest + '  ' + name).sort();
  replaceFile(path.join(directory, 'SHA256SUMS'),
    temporary => fs.writeFileSync(temporary, lines.join('\n') + '\n', { flag: 'wx' }));
}

function files(directory, prefix = '') {
  noLinks(directory);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const full = path.join(directory, entry.name);
    noLinks(full);
    if (entry.isDirectory()) result.push(...files(full, name + '/'));
    else {
      regular(full);
      if (name !== '.incomplete' && name !== 'SHA256SUMS') result.push(managed(name));
    }
  }
  return result;
}

export function check(output) {
  output = path.resolve(output);
  if (path.dirname(output) === output) throw new Error('A filesystem root cannot be a build directory.');
  noLinks(output);
  const info = stat(output);
  if (!info) return new Map();
  if (!info.isDirectory()) throw new Error('Output is not a directory: ' + output);
  if (fs.readdirSync(output).length === 0) return new Map();
  const incomplete = regular(path.join(output, '.incomplete'), true);
  regular(path.join(output, 'release.json'));
  // An interrupted update can list both spellings of a case-only rename.
  return manifest(output, Boolean(incomplete));
}

export function assemble(stage, root, os, revision, dirty, rebuilt) {
  if (!['windows', 'linux'].includes(os) || !['true', 'false'].includes(dirty) ||
      !['true', 'false'].includes(rebuilt)) throw new Error('Invalid assembly arguments.');
  noLinks(stage);
  // Inspect all existing staged files before writing metadata.
  files(stage);
  const marker = path.join(stage, '.incomplete');
  fs.writeFileSync(marker, 'Build assembly has not completed.\n');
  const launcher = os === 'windows' ? 'start.bat' : 'start.sh';
  for (const [source, destination] of [
    [path.join(root, 'scripts', 'launch', launcher), launcher],
    [path.join(root, 'docs', 'packaging-start.md'), 'START.md'],
  ]) {
    regular(source);
    fs.copyFileSync(source, path.join(stage, destination));
  }
  if (os === 'linux') fs.chmodSync(path.join(stage, launcher), 0o755);
  const source = { webRevision: revision, webDirty: dirty === 'true', webRebuilt: rebuilt === 'true' };
  fs.writeFileSync(path.join(stage, 'web-source.json'), JSON.stringify(source, null, 2) + '\n');
  writeManifest(stage, new Map(files(stage).map(name => [name, hash(path.join(stage, name))])));
  fs.unlinkSync(marker);
}

function safeStage(stage, output) {
  const prefix = '.' + path.basename(output) + '.build-';
  if (path.dirname(stage) !== path.dirname(output) ||
      !path.basename(stage).startsWith(prefix) ||
      !/^[0-9a-f-]{36}$/i.test(path.basename(stage).slice(prefix.length))) {
    throw new Error('Staging directory must be a unique sibling of the output directory.');
  }
  noLinks(stage);
}

export function publish(stage, output) {
  stage = path.resolve(stage);
  output = path.resolve(output);
  safeStage(stage, output);
  const next = manifest(stage);
  if (stat(path.join(stage, '.incomplete'))) throw new Error('Staged build is incomplete.');
  const stagedFiles = files(stage);
  if (stagedFiles.length !== next.size) throw new Error('Staged build contains unlisted files.');
  for (const name of stagedFiles) {
    if (hash(path.join(stage, name)) !== next.get(name)) throw new Error('Staged checksum mismatch: ' + name);
  }
  const lock = output + '.update-lock';
  noLinks(lock);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another update is active, or its lock remains: ' + lock);
    throw error;
  }
  try {
    const previous = check(output);
    if (previous.size) {
      const before = JSON.parse(fs.readFileSync(path.join(output, 'release.json'), 'utf8'));
      const after = JSON.parse(fs.readFileSync(path.join(stage, 'release.json'), 'utf8'));
      if (before.os !== after.os || before.arch !== after.arch) {
        throw new Error('Existing output targets a different platform. Choose another output directory.');
      }
    }
    // Read and preflight under the lock so concurrent updates cannot use stale state.
    const all = new Map([...previous, ...next]);
    for (const name of all.keys()) {
      const destination = path.join(output, name);
      if (regular(destination, true)) {
        try { fs.closeSync(fs.openSync(destination, 'r+')); }
        catch { throw new Error('Cannot update build file; stop MusicFS and retry: ' + destination); }
      }
    }
    if (!previous.size) {
      // Both absolute paths have been checked as siblings, without links.
      safeStage(stage, output);
      if (stat(output)) fs.rmdirSync(output);
      fs.renameSync(stage, output);
      return;
    }
    fs.writeFileSync(path.join(output, '.incomplete'), 'Build update has not completed. Run the build again.\n');
    // Keep the union during an update so a retry can also remove partial assets.
    writeManifest(output, all);
    for (const name of next.keys()) {
      const source = path.join(stage, name);
      const destination = path.join(output, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      replaceFile(destination, temporary => {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporary, fs.statSync(source).mode & 0o777);
      });
    }
    // Resolve after replacement: case aliases share a path only on insensitive filesystems.
    const retained = new Set([...next.keys()].map(name => fs.realpathSync.native(path.join(output, name))));
    for (const name of previous.keys()) {
      const obsolete = path.join(output, name);
      if (!next.has(name) && stat(obsolete) && !retained.has(fs.realpathSync.native(obsolete))) {
        fs.unlinkSync(obsolete);
      }
    }
    writeManifest(output, next);
    fs.unlinkSync(path.join(output, '.incomplete'));
    // Only remove the validated staging sibling; never remove the runtime tree.
    safeStage(stage, output);
    files(stage);
    fs.rmSync(stage, { recursive: true });
  } finally {
    fs.rmdirSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'check' && args.length === 1) check(...args);
    else if (command === 'assemble' && args.length === 6) assemble(...args);
    else if (command === 'publish' && args.length === 2) publish(...args);
    else throw new Error('Usage: package-files.mjs check|assemble|publish <arguments>');
  } catch (error) {
    console.error('Build error: ' + error.message);
    process.exitCode = 1;
  }
}
