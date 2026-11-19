#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {
  ArtifactStore,
  evaluateVisualOpportunity,
  inferTypeFromPathOrContent,
  slugify,
} from '../core/storage.js';
import { resolveRepository } from '../core/resolve-repository.js';
import { seedStarterArtifacts } from '../core/seed.js';
import { startArtifactServer } from '../server/server.js';
import { runMcpServer, notifyRunningDaemon } from '../mcp/mcp-server.js';
import { installAgentIntegrations } from '../integrations/installer.js';
import { CredentialVault } from './credentials.js';
import { loginWithDeviceFlow, loginWithLoopbackPkce } from './auth.js';
import { CloudHttpRepository } from '../client/cloud-repository.js';
import type {
  ArtifactType,
  BatchSharePrincipalSpec,
  BatchShareResourceSpec,
} from '../core/types.js';

const program = new Command();

function requireCloudRepo(opts: {
  dataDir?: string;
  cloud?: string;
  workspace?: string;
}): { vault: CredentialVault; repo: CloudHttpRepository } {
  const vault = new CredentialVault(opts.dataDir);
  const cfg = vault.readConfig();
  const creds = vault.readCredentials();
  const cloudUrl =
    opts.cloud || process.env.MYARTIFACT_CLOUD_URL || cfg.cloudUrl || creds?.cloudUrl;
  if (!cloudUrl) {
    console.error('Error: No cloud server configured. Run "myartifact login --cloud <url>" first.');
    process.exit(1);
  }
  const repo = new CloudHttpRepository({
    cloudUrl,
    vault,
    workspace: opts.workspace || cfg.defaultWorkspace || creds?.defaultWorkspaceId,
    agent: 'cli',
  });
  return { vault, repo };
}

program
  .name('myartifact')
  .enablePositionalOptions()
  .description(
    'Local-first & Cloud RBAC cross-assistant visual artifact studio & MCP server for Claude Code, Codex, and Antigravity'
  )
  .version('1.1.0');

program
  .command('serve')
  .description('Start the MyArtifact web UI, REST/WebSocket server (local or cloud RBAC mode)')
  .option('-p, --port <port>', 'Port to listen on', process.env.MYARTIFACT_PORT || '4173')
  .option('-H, --host <host>', 'Host to bind to', process.env.MYARTIFACT_HOST || '127.0.0.1')
  .option('-d, --data-dir <dir>', 'Custom storage directory (default: ~/.myartifact)')
  .option('-w, --watch <dirs...>', 'Additional directories to watch for artifact files')
  .option('--cloud', 'Start in multi-tenant cloud mode with Google OIDC, RBAC & batch sharing')
  .option('--public-url <url>', 'Public base URL for OAuth callbacks and share links')
  .option('--no-seed', 'Do not seed starter artifacts when local database is empty')
  .action(async (opts) => {
    const isCloud = Boolean(opts.cloud) || process.env.MYARTIFACT_MODE === 'cloud';
    if (isCloud) {
      const running = await startArtifactServer({
        port: Number(opts.port),
        host: opts.host,
        mode: 'cloud',
        cloud: {
          dataDir: opts.dataDir,
          publicBaseUrl: opts.publicUrl || process.env.MYARTIFACT_PUBLIC_URL,
        },
      });
      console.log(`\n☁️  MyArtifact Cloud Server is running!`);
      console.log(`   ➜ Web & API:  http://${running.host}:${running.port}`);
      console.log(`   ➜ Auth Mode:  Google OIDC + RBAC + Delegated CLI Agent Ceiling\n`);
      return;
    }

    const store = new ArtifactStore(opts.dataDir);
    if (opts.seed !== false) {
      seedStarterArtifacts(store);
    }
    const running = await startArtifactServer({
      port: Number(opts.port),
      host: opts.host,
      mode: 'local',
      store,
      watchDirs: opts.watch || [],
    });
    console.log(`\n✨ MyArtifact Local Workspace is running!`);
    console.log(`   ➜ Web UI:    http://${running.host}:${running.port}`);
    console.log(`   ➜ Data Dir:  ${store.dataDir}`);
    console.log(`   ➜ Dropzone:  ${store.dropzoneDir}`);
    console.log(`   ➜ TB Runs:   ${store.runsDir}\n`);
  });

// ===========================================================================
// Cloud Login, Session & Profile Commands
// ===========================================================================
program
  .command('login')
  .description('Log in once with Google so local CLI & coding agents (Claude Code, Codex, Antigravity) share your cloud identity')
  .option('--cloud <url>', 'MyArtifact Cloud server URL', process.env.MYARTIFACT_CLOUD_URL || 'https://myartifact.app')
  .option('--device', 'Use RFC 8628 device-code flow (recommended for SSH / headless containers)')
  .option('--elevate', 'Request short-lived elevated permissions (allows batch sharing and deletes)')
  .option('-w, --workspace <ws>', 'Default workspace slug or ID')
  .option('--no-browser', 'Do not attempt to open the system browser automatically')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const loginFn = opts.device ? loginWithDeviceFlow : loginWithLoopbackPkce;
    const creds = await loginFn({
      cloudUrl: opts.cloud,
      dataDir: opts.dataDir,
      device: Boolean(opts.device),
      elevate: Boolean(opts.elevate),
      workspace: opts.workspace,
      noBrowser: opts.browser === false,
    });
    console.log(`✅ Logged into MyArtifact Cloud (${creds.cloudUrl})`);
    console.log(`   ➜ User:       ${creds.user.displayName} <${creds.user.email}>`);
    console.log(`   ➜ Session:    ${creds.sessionKind} (scopes: ${creds.scopes.join(', ')})`);
    if (creds.defaultWorkspaceId) {
      console.log(`   ➜ Workspace:  ${creds.defaultWorkspaceId}`);
    }
    console.log(`   ➜ Profile switched to "cloud" — MCP & CLI agents now authenticate automatically.`);
  });

program
  .command('logout')
  .description('Revoke current CLI cloud session and clear local credentials')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const vault = new CredentialVault(opts.dataDir);
    const creds = vault.readCredentials();
    if (creds) {
      try {
        await fetch(`${creds.cloudUrl}/api/auth/sessions/${encodeURIComponent(creds.sessionId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        });
      } catch {
        // Best-effort remote revocation
      }
    }
    vault.clearCredentials();
    const cfg = vault.readConfig();
    vault.writeConfig({ ...cfg, profile: 'local' });
    console.log('👋 Logged out and switched active profile back to "local".');
  });

program
  .command('whoami')
  .description('Show active MyArtifact profile, cloud identity, workspace, and agent scopes')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const vault = new CredentialVault(opts.dataDir);
    const cfg = vault.readConfig();
    const creds = vault.readCredentials();
    console.log(`Profile:   ${cfg.profile}`);
    if (cfg.cloudUrl || creds?.cloudUrl) {
      console.log(`Cloud URL: ${cfg.cloudUrl || creds?.cloudUrl}`);
    }
    if (!creds) {
      console.log('Cloud Auth: Not logged in (run "myartifact login --cloud <url>")');
      return;
    }
    console.log(`User:      ${creds.user.displayName} <${creds.user.email}>`);
    console.log(`Google HD: ${creds.user.googleHd || '(personal)'}`);
    console.log(`Session:   ${creds.sessionId} (${creds.sessionKind})`);
    console.log(`Scopes:    ${creds.scopes.join(', ')}`);
    console.log(`Workspace: ${cfg.defaultWorkspace || creds.defaultWorkspaceId || '(default)'}`);
  });

program
  .command('profile <mode>')
  .description('Switch active CLI/MCP target profile ("local" or "cloud")')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action((mode, opts) => {
    if (mode !== 'local' && mode !== 'cloud') {
      console.error('Error: profile must be "local" or "cloud"');
      process.exit(1);
    }
    const vault = new CredentialVault(opts.dataDir);
    const cfg = vault.readConfig();
    vault.writeConfig({ ...cfg, profile: mode });
    console.log(`✅ Active profile set to "${mode}".`);
  });

const wsCmd = program.command('workspace').description('Manage and switch cloud workspaces');

wsCmd
  .command('list')
  .description('List accessible cloud workspaces')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const { repo, vault } = requireCloudRepo(opts);
    const cfg = vault.readConfig();
    const workspaces = await repo.listWorkspaces();
    for (const w of workspaces) {
      const active =
        cfg.defaultWorkspace === w.id || cfg.defaultWorkspace === w.slug ? ' *' : '';
      console.log(
        `• ${w.slug} (${w.name}) [${w.effectiveRole || 'member'}${w.isPersonal ? ' · personal' : ''}] id=${w.id}${active}`
      );
    }
  });

wsCmd
  .command('use <workspace>')
  .description('Set default cloud workspace for CLI & MCP agents')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (workspace, opts) => {
    const { repo, vault } = requireCloudRepo(opts);
    const list = await repo.listWorkspaces();
    const match = list.find((w) => w.id === workspace || w.slug === workspace);
    if (!match) {
      console.error(`Error: Workspace not found or inaccessible: ${workspace}`);
      process.exit(1);
    }
    const cfg = vault.readConfig();
    vault.writeConfig({ ...cfg, profile: 'cloud', defaultWorkspace: match.id });
    const creds = vault.readCredentials();
    if (creds) {
      vault.writeCredentials({ ...creds, defaultWorkspaceId: match.id });
    }
    console.log(`✅ Active workspace switched to "${match.slug}" (${match.name}).`);
  });

wsCmd
  .command('create <name>')
  .description('Create a new team workspace')
  .option('--slug <slug>', 'Workspace slug')
  .option('--domain <hd>', 'Optional Google Workspace domain hint')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (name, opts) => {
    const { repo } = requireCloudRepo(opts);
    const ws = await repo.createWorkspace(name, opts.slug, opts.domain);
    console.log(`✅ Created workspace "${ws.slug}" (${ws.name}) [id=${ws.id}]`);
  });

// ===========================================================================
// Batch Sharing Command
// ===========================================================================
const shareCmd = program
  .command('share [artifacts...]')
  .description('Batch-share artifacts, projects, or wiki categories with emails, groups, or Google domains')
  .option('-p, --project <project>', 'Share an entire project (or scope --category)')
  .option('-c, --category <prefix>', 'Share an entire wiki category folder under --project')
  .option('-e, --emails <list>', 'Comma-separated emails to grant access to (auto-invites unregistered emails)')
  .option('-g, --group <group>', 'Workspace group slug or ID')
  .option('--domain <domain>', 'Grant access to any verified Google Workspace user at @domain')
  .option('-r, --role <role>', 'Role to grant (viewer | editor | admin)', 'viewer')
  .option('--expires <isoDate>', 'Optional ISO expiration timestamp')
  .option('--set-exact', 'Allow downgrading existing higher roles (defaults to upgrade_only)')
  .option('--revoke', 'Revoke instead of granting')
  .option('-w, --workspace <ws>', 'Workspace slug or ID')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (artifacts: string[], opts) => {
    const { repo } = requireCloudRepo(opts);
    const resources: BatchShareResourceSpec[] = [];
    for (const id of artifacts || []) {
      resources.push({ type: 'artifact', id });
    }
    if (opts.category) {
      if (!opts.project) {
        console.error('Error: --category requires --project <slug>');
        process.exit(1);
      }
      resources.push({ type: 'category', projectId: opts.project, prefix: opts.category });
    } else if (opts.project) {
      resources.push({ type: 'project', id: opts.project });
    }
    if (resources.length === 0) {
      console.error('Error: Specify artifact slugs/IDs, --project, or --category');
      process.exit(1);
    }

    const principals: BatchSharePrincipalSpec[] = [];
    if (opts.emails) {
      for (const email of String(opts.emails).split(',')) {
        const clean = email.trim();
        if (clean) principals.push({ type: 'email', email: clean });
      }
    }
    if (opts.group) {
      principals.push({ type: 'group', groupId: String(opts.group).trim() });
    }
    if (opts.domain) {
      principals.push({ type: 'domain', domain: String(opts.domain).trim() });
    }
    if (principals.length === 0) {
      console.error('Error: Specify --emails, --group, or --domain');
      process.exit(1);
    }

    if (opts.revoke) {
      const res = await repo.revokeBatch({ resources, principals }, opts.workspace);
      console.log(`✅ Revoked ${res.revokedCount} binding(s).`);
      return;
    }

    const res = await repo.shareBatch(
      {
        resources,
        principals,
        role: opts.role,
        mode: opts.setExact ? 'set_exact' : 'upgrade_only',
        expiresAt: opts.expires,
      },
      opts.workspace
    );
    console.log(
      `✅ Batch share complete across ${res.targetResourceCount} resource(s): ${res.applied} created, ${res.upgraded} upgraded, ${res.unchanged} unchanged.`
    );
    if (res.pendingEmailInvites.length > 0) {
      console.log(`   ➜ Pending Google invites queued: ${res.pendingEmailInvites.join(', ')}`);
    }
  });

shareCmd
  .command('link [artifacts...]')
  .description('Create a shareable capability link for selected artifacts, a project, or a category')
  .option('-p, --project <project>', 'Target project slug')
  .option('-c, --category <prefix>', 'Target category prefix')
  .option('--domain <hd>', 'Restrict link to verified Google Workspace domain')
  .option('-r, --role <role>', 'Link role (viewer | editor)', 'viewer')
  .option('--label <label>', 'Optional link label')
  .option('-w, --workspace <ws>', 'Workspace slug or ID')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (artifacts: string[], opts) => {
    const { repo } = requireCloudRepo(opts);
    const targetSpec =
      artifacts && artifacts.length > 0
        ? {
            kind: (artifacts.length === 1 ? 'artifact' : 'collection') as 'artifact' | 'collection',
            artifactIds: artifacts,
          }
        : opts.category
        ? {
            kind: 'category' as const,
            projectSlug: opts.project || 'general',
            categoryPrefix: opts.category,
          }
        : {
            kind: 'project' as const,
            projectSlug: opts.project || 'general',
          };

    const res = await repo.createShareLink(
      {
        accessMode: opts.domain ? 'domain' : 'anyone',
        requiredHd: opts.domain,
        role: opts.role === 'editor' ? 'editor' : 'viewer',
        targetSpec,
        label: opts.label,
      },
      opts.workspace
    );
    console.log(`🔗 Share Link created (${res.link.accessMode}${res.link.requiredHd ? ` @${res.link.requiredHd}` : ''}):`);
    console.log(`   ${res.shareUrl}`);
  });

const cloudCmd = program.command('cloud').description('Cloud sync and migration utilities');

cloudCmd
  .command('migrate')
  .description('Upload existing local ~/.myartifact artifacts, version histories, storage & TensorBoard runs to Cloud')
  .option('-w, --workspace <ws>', 'Target cloud workspace')
  .option('--cloud <url>', 'Cloud server URL')
  .option('-d, --data-dir <dir>', 'Local storage directory')
  .action(async (opts) => {
    const { repo } = requireCloudRepo(opts);
    const localStore = new ArtifactStore(opts.dataDir);
    try {
      const summary = await repo.migrateFromLocalStore(localStore);
      console.log(
        `☁️  Migration complete: ${summary.artifactsMigrated} artifact(s), ${summary.versionsMigrated} version(s), ${summary.storageKeysMigrated} storage key(s), ${summary.checkpointsMigrated} checkpoint(s).`
      );
    } finally {
      localStore.close();
    }
  });

// ===========================================================================
// Core Artifact Commands (Dual Local + Cloud via resolveRepository)
// ===========================================================================
program
  .command('push [file]')
  .description(
    'Create or update an artifact from a local file (works seamlessly against local store or logged-in Cloud)'
  )
  .option('-i, --id <slug>', 'Artifact slug or ID (auto-derived from filename/title if omitted)')
  .option('-t, --title <title>', 'Artifact title')
  .option('--type <type>', 'Artifact type (react | html | markdown | mermaid | svg | code)')
  .option('-a, --agent <agent>', 'Assistant name (claude-code | codex | antigravity | user)', 'user')
  .option('-p, --project <project>', 'Project slug to group artifacts under')
  .option('-c, --category <category>', 'LLM Wiki category path within the project')
  .option('--description <description>', 'One-line summary for the LLM Wiki index.md')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--links <links>', 'Comma-separated related artifact slugs ([[wiki-links]])')
  .option('--icon <icon>', 'Custom 32x32 SVG logo markup, file path, or preset id')
  .option('-s, --summary <summary>', 'Version commit message / summary')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('--cloud <url>', 'Override cloud URL')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (file, opts) => {
    if (!file) {
      console.error('Error: Please provide a file path to push.');
      process.exit(1);
    }
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: File not found: ${resolvedPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const inferred = inferTypeFromPathOrContent(resolvedPath, content);
    const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
    const slug = opts.id || slugify(opts.title || baseName);
    const title =
      opts.title ||
      baseName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const tags = opts.tags
      ? String(opts.tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [opts.type || inferred.type];
    const links = opts.links
      ? String(opts.links)
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
      : undefined;

    let iconArg: string | undefined = opts.icon;
    if (iconArg && !iconArg.trim().startsWith('<svg') && fs.existsSync(path.resolve(iconArg))) {
      iconArg = fs.readFileSync(path.resolve(iconArg), 'utf8');
    }

    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      cloudUrl: opts.cloud,
      workspace: opts.workspace,
      agent: opts.agent,
    });
    const artifact = await repo.upsertBySlug(slug, {
      title,
      description: opts.description,
      type: (opts.type as ArtifactType) || inferred.type,
      language: inferred.language,
      content,
      agent: opts.agent,
      project: opts.project,
      category: opts.category,
      tags,
      links,
      icon: iconArg,
      summary: opts.summary,
    });

    const visualHint = evaluateVisualOpportunity({
      type: artifact.type,
      category: artifact.category,
      content: artifact.content,
      title: artifact.title,
    });

    if (repo.mode === 'local') {
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    }
    await repo.close();

    const baseUrl =
      repo.mode === 'cloud' && repo instanceof CloudHttpRepository
        ? repo.cloudUrl
        : `http://127.0.0.1:${process.env.MYARTIFACT_PORT || '4173'}`;
    console.log(
      `✅ Synced [${repo.mode}] "${artifact.title}" (${artifact.slug}) -> v${artifact.currentVersion} [${artifact.type}] in [${artifact.project} / ${artifact.category}]`
    );
    console.log(`   ➜ Artifact Page: ${baseUrl}/artifacts/${artifact.slug}`);
    if (visualHint) {
      console.log(`   💡 ${visualHint}`);
    }
  });

program
  .command('index')
  .description('Print the LLM Wiki master catalog (index.md) or structured taxonomy grouped by project and category')
  .option('-p, --project <project>', 'Filter the wiki index to a specific project slug')
  .option('--json', 'Output structured projects, categories, and backlinks as JSON')
  .option('--sync', 'Force re-sync of ~/.myartifact/index.md from SQLite (local mode)')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
    });
    if (opts.sync && repo.mode === 'local' && 'store' in repo) {
      (repo as { store: ArtifactStore }).store.syncWikiIndexFile();
    }
    const md = await repo.getWikiIndexMarkdown(opts.project);
    if (opts.json) {
      const taxonomy = await repo.getWikiTaxonomy(opts.project);
      await repo.close();
      console.log(JSON.stringify({ ...taxonomy, indexMarkdown: md }, null, 2));
      return;
    }
    await repo.close();
    process.stdout.write(md + '\n');
  });

program
  .command('log')
  .description('Print the append-only LLM Wiki chronological operation log (log.md)')
  .option('-n, --lines <count>', 'Show only the last N log entries')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
    });
    const logMd = await repo.getWikiLogMarkdown();
    await repo.close();
    if (opts.lines) {
      const allLines = logMd.trim().split('\n');
      const tailCount = Math.max(1, Number(opts.lines));
      console.log(allLines.slice(-tailCount).join('\n'));
      return;
    }
    process.stdout.write(logMd);
  });

program
  .command('list')
  .description('List and search stored artifacts across assistants')
  .option('-q, --query <query>', 'Full-text search query')
  .option('-a, --agent <agent>', 'Filter by agent (claude-code | codex | antigravity)')
  .option('--type <type>', 'Filter by artifact type')
  .option('-p, --project <project>', 'Filter by project slug')
  .option('-c, --category <category>', 'Filter by LLM Wiki category path')
  .option('--json', 'Output as JSON')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
    });
    const list = await repo.listArtifacts({
      query: opts.query,
      agent: opts.agent,
      type: opts.type as ArtifactType,
      project: opts.project,
      category: opts.category,
    });
    await repo.close();

    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }

    if (list.length === 0) {
      console.log('No artifacts found.');
      return;
    }

    for (const item of list) {
      const linksSuffix =
        item.links && item.links.length > 0
          ? ` [links: ${item.links.map((l) => `[[${l}]]`).join(', ')}]`
          : '';
      const roleSuffix = item.effectiveRole ? ` · role:${item.effectiveRole}` : '';
      console.log(
        `• [${item.project} / ${item.category}] [[${item.slug}]] v${item.currentVersion} (${item.type} | ${item.agent}${roleSuffix}) — ${item.title}${linksSuffix}`
      );
      if (item.description) {
        console.log(`    ↳ ${item.description}`);
      }
    }
  });

program
  .command('get <id>')
  .description('Get an artifact’s source code or metadata by ID or slug')
  .option('-v, --version <version>', 'Specific version number to retrieve')
  .option('--json', 'Output full metadata + storage as JSON')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (id, opts) => {
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
    });
    const artifact = await repo.getArtifact(id);
    if (!artifact) {
      await repo.close();
      console.error(`Error: Artifact not found: ${id}`);
      process.exit(1);
    }

    const versionNum = opts.version ? Number(opts.version) : artifact.currentVersion;
    const content = opts.version
      ? await repo.getVersionContent(artifact.id, versionNum)
      : artifact.content;
    const storage = await repo.getAllStorageEntries(artifact.id);
    await repo.close();

    if (content === null) {
      console.error(`Error: Version ${versionNum} not found for ${id}`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(
        JSON.stringify({ artifact: { ...artifact, content }, version: versionNum, storage }, null, 2)
      );
    } else {
      process.stdout.write(content);
    }
  });

program
  .command('mcp')
  .description('Start the MyArtifact MCP server over stdio for Claude Code, Codex, and Antigravity')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (opts) => {
    await runMcpServer(opts.dataDir);
  });

program
  .command('setup')
  .description('Install MyArtifact skills (SKILL.md) and MCP config for Antigravity, Claude Code, and Codex')
  .option('-t, --target <dir>', 'Workspace directory to configure', process.cwd())
  .option('-g, --global', 'Also install into global ~/.gemini, ~/.claude, and ~/.codex skill directories')
  .action((opts) => {
    const result = installAgentIntegrations({
      targetDir: opts.target,
      global: Boolean(opts.global),
    });
    console.log('✅ Installed MyArtifact skills & MCP configurations:');
    for (const f of result.writtenFiles) {
      console.log(`   • ${f}`);
    }
  });

const tbCmd = program
  .command('tb')
  .description('TensorBoard training run & model checkpoint commands');

tbCmd
  .command('log <run>')
  .description('Log scalar training metrics to a TensorBoard run')
  .option('-s, --step <step>', 'Training step number', '0')
  .option('-e, --epoch <epoch>', 'Training epoch number')
  .option('-m, --metric <items...>', 'Metric key=value pairs (e.g. train/loss=0.42 val/acc=0.91)')
  .option('-t, --title <title>', 'Run title')
  .option('--model <model>', 'Model architecture name')
  .option('--framework <framework>', 'Framework (pytorch | tensorflow | jax)', 'pytorch')
  .option('--status <status>', 'Run status (running | completed | failed)')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (run, opts) => {
    const metrics: Record<string, number> = {};
    for (const item of opts.metric || []) {
      const [k, v] = String(item).split('=');
      if (k && v !== undefined && !Number.isNaN(Number(v))) {
        metrics[k.trim()] = Number(v);
      }
    }
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
      agent: opts.agent,
    });
    const artifact = await repo.logTensorBoardScalars({
      slug: run,
      title: opts.title,
      modelName: opts.model,
      framework: opts.framework,
      status: opts.status,
      agent: opts.agent,
      step: Number(opts.step || 0),
      epoch: opts.epoch !== undefined ? Number(opts.epoch) : undefined,
      metrics,
    });
    if (repo.mode === 'local') {
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    }
    await repo.close();
    const baseUrl =
      repo.mode === 'cloud' && repo instanceof CloudHttpRepository
        ? repo.cloudUrl
        : `http://127.0.0.1:${process.env.MYARTIFACT_PORT || '4173'}`;
    console.log(
      `📈 Logged ${Object.keys(metrics).length} scalar(s) at step ${opts.step} to TensorBoard run "${artifact.slug}"`
    );
    console.log(`   ➜ Artifact Page: ${baseUrl}/artifacts/${artifact.slug}`);
  });

tbCmd
  .command('save-model <run> [file]')
  .description('Save and version a trained model checkpoint under a TensorBoard run')
  .option('-n, --name <name>', 'Checkpoint filename')
  .option('-s, --step <step>', 'Training step', '0')
  .option('-e, --epoch <epoch>', 'Training epoch')
  .option('-m, --metric <items...>', 'Validation metric key=value pairs (e.g. val/loss=0.31)')
  .option('--best', 'Mark this checkpoint as the best model')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('--summary <summary>', 'Version commit message')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (run, file, opts) => {
    const metrics: Record<string, number> = {};
    for (const item of opts.metric || []) {
      const [k, v] = String(item).split('=');
      if (k && v !== undefined && !Number.isNaN(Number(v))) {
        metrics[k.trim()] = Number(v);
      }
    }
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
      agent: opts.agent,
    });
    const { artifact, checkpoint } = await repo.saveModelCheckpoint({
      slug: run,
      name: opts.name,
      step: Number(opts.step || 0),
      epoch: opts.epoch !== undefined ? Number(opts.epoch) : undefined,
      sourceFilePath: file ? path.resolve(file) : undefined,
      metrics,
      isBest: Boolean(opts.best),
      agent: opts.agent,
      summary: opts.summary,
    });
    if (repo.mode === 'local') {
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    }
    await repo.close();
    const baseUrl =
      repo.mode === 'cloud' && repo instanceof CloudHttpRepository
        ? repo.cloudUrl
        : `http://127.0.0.1:${process.env.MYARTIFACT_PORT || '4173'}`;
    console.log(
      `💾 Saved model checkpoint "${checkpoint.name}" (step ${checkpoint.step}, sha256: ${checkpoint.sha256.slice(0, 10)}…) -> ${artifact.slug} v${artifact.currentVersion}`
    );
    console.log(`   ➜ Artifact Page: ${baseUrl}/artifacts/${artifact.slug}`);
  });

tbCmd
  .command('import <file>')
  .description('Import an existing TensorBoard events.out.tfevents.* file')
  .option('-r, --run <slug>', 'Target run slug')
  .option('-t, --title <title>', 'Run title')
  .option('-a, --agent <agent>', 'Assistant name', 'user')
  .option('--profile <profile>', 'Override profile (local | cloud)')
  .option('-w, --workspace <ws>', 'Override cloud workspace')
  .option('-d, --data-dir <dir>', 'Custom storage directory')
  .action(async (file, opts) => {
    const repo = resolveRepository({
      dataDir: opts.dataDir,
      profile: opts.profile,
      workspace: opts.workspace,
      agent: opts.agent,
    });
    const artifact = await repo.importTfEventsFile(file, {
      slug: opts.run,
      title: opts.title,
      agent: opts.agent,
    });
    if (repo.mode === 'local') {
      await notifyRunningDaemon({ type: 'artifact:updated', artifact });
    }
    await repo.close();
    const baseUrl =
      repo.mode === 'cloud' && repo instanceof CloudHttpRepository
        ? repo.cloudUrl
        : `http://127.0.0.1:${process.env.MYARTIFACT_PORT || '4173'}`;
    console.log(
      `✅ Imported TensorBoard events into "${artifact.title}" (${artifact.slug}) -> v${artifact.currentVersion}`
    );
    console.log(`   ➜ Artifact Page: ${baseUrl}/artifacts/${artifact.slug}`);
  });

program.parseAsync(process.argv);
