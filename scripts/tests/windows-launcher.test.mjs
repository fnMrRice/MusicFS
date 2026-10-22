import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows launcher distinguishes configuration files and directories',
  { skip: process.platform !== 'win32' }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfs-launcher-test-'));
    t.after(() => {
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('musicfs-launcher-test-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    });
    const root = path.join(directory, 'package with spaces');
    for (const name of ['bin', 'web', 'configs']) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
    }
    fs.copyFileSync(fileURLToPath(new URL('../launch/start.bat', import.meta.url)),
      path.join(root, 'start.bat'));
    // Node acts as a native executable stub and runs the "serve" fixture.
    fs.copyFileSync(process.execPath, path.join(root, 'bin/musicfs.exe'));
    fs.writeFileSync(path.join(root, 'serve'), 'console.log("Fixture server reached");\n');
    fs.writeFileSync(path.join(root, 'web/index.html'), '<html></html>');
    const config = path.join(root, 'configs/server.yaml');
    const example = 'configVersion: 1\n';
    fs.writeFileSync(path.join(root, 'configs/server.example.yaml'), example);
    const run = () => {
      const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start.bat'], {
        cwd: root, encoding: 'utf8', input: '', timeout: 15000, windowsHide: true,
        env: { ...process.env, MUSICFS_ADMIN_TOKEN: 'launcher-test-credential-only' },
      });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    };

    await t.test('first launch creates a regular configuration and reaches the server', () => {
      const result = run();
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Fixture server reached/);
      assert.equal(fs.readFileSync(config, 'utf8'), example);
    });
    await t.test('existing configuration is preserved and reaches the server', () => {
      const customized = 'configVersion: 1\nlisten: "127.0.0.1:8090"\n';
      fs.writeFileSync(config, customized);
      const result = run();
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Fixture server reached/);
      assert.equal(fs.readFileSync(config, 'utf8'), customized);
    });
    await t.test('a directory at the configuration path is rejected', () => {
      fs.unlinkSync(config);
      fs.mkdirSync(config);
      const result = run();
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /server\.yaml must be a regular file/);
      assert.doesNotMatch(result.output, /Fixture server reached/);
    });
  });
