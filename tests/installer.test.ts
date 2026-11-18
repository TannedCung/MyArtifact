import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installAgentIntegrations } from '../src/integrations/installer.js';

describe('Cross-Assistant Skill & MCP Installer', () => {
  test('generates Antigravity (.agents), Claude Code (.claude), and .mcp.json files', () => {
    const tmpWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'myartifact-installer-test-')
    );

    const res = installAgentIntegrations({
      targetDir: tmpWorkspace,
      global: false,
      cliEntryPath: '/custom/path/dist/cli.js',
    });

    assert.equal(res.writtenFiles.length, 3);

    const agySkill = path.join(
      tmpWorkspace,
      '.agents',
      'skills',
      'myartifact',
      'SKILL.md'
    );
    const claudeSkill = path.join(
      tmpWorkspace,
      '.claude',
      'skills',
      'myartifact',
      'SKILL.md'
    );
    const mcpJson = path.join(tmpWorkspace, '.mcp.json');

    assert.ok(fs.existsSync(agySkill));
    assert.ok(fs.existsSync(claudeSkill));
    assert.ok(fs.existsSync(mcpJson));

    const skillContent = fs.readFileSync(agySkill, 'utf8');
    assert.ok(skillContent.includes('name: myartifact'));
    assert.ok(skillContent.includes('Visual-First'));
    assert.ok(skillContent.includes('Format Decision Matrix'));
    assert.ok(skillContent.includes('recharts'));
    assert.ok(skillContent.includes('three/addons/'));
    assert.ok(skillContent.includes('scene-3d'));
    assert.ok(skillContent.includes('window.storage'));
    assert.ok(skillContent.includes('artifact_create'));

    const mcpParsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
    assert.deepEqual(mcpParsed.mcpServers.myartifact, {
      command: 'node',
      args: ['/custom/path/dist/cli.js', 'mcp'],
    });

    // Also verify omitted cliEntryPath resolves to an absolute path (never relative ./dist)
    const tmpWorkspace2 = fs.mkdtempSync(
      path.join(os.tmpdir(), 'myartifact-installer-default-path-')
    );
    installAgentIntegrations({
      targetDir: tmpWorkspace2,
      global: false,
    });
    const defaultSkill = fs.readFileSync(
      path.join(tmpWorkspace2, '.agents', 'skills', 'myartifact', 'SKILL.md'),
      'utf8'
    );
    assert.ok(!defaultSkill.includes('node "./dist/cli/cli.js"'));
    const defaultMcp = JSON.parse(
      fs.readFileSync(path.join(tmpWorkspace2, '.mcp.json'), 'utf8')
    );
    assert.ok(path.isAbsolute(defaultMcp.mcpServers.myartifact.args[0]));

    fs.rmSync(tmpWorkspace2, { recursive: true, force: true });
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });
});
