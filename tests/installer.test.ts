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
    assert.ok(skillContent.includes('window.storage'));
    assert.ok(skillContent.includes('artifact_create'));

    const mcpParsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
    assert.deepEqual(mcpParsed.mcpServers.myartifact, {
      command: 'node',
      args: ['/custom/path/dist/cli.js', 'mcp'],
    });

    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });
});
