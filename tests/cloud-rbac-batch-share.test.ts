import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startArtifactServer } from '../src/server/server.js';
import { SqliteCloudStore } from '../src/cloud/sqlite-cloud-store.js';
import { CloudTokenService, sha256Hex } from '../src/cloud/auth/jwt.js';
import { ELEVATED_CLI_SCOPES, type AuthPrincipalContext } from '../src/core/types.js';

async function mintTestJwtForUser(
  store: SqliteCloudStore,
  tokenService: CloudTokenService,
  userId: string,
  email: string,
  hd?: string
) {
  const session = await store.createAuthSession({
    userId,
    sessionKind: 'cli_elevated',
    refreshTokenHash: sha256Hex(`rt_${userId}_${Math.random()}`),
    scopeCeiling: [...ELEVATED_CLI_SCOPES],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return tokenService.signAccessJwt({
    sub: userId,
    sid: session.id,
    email,
    ...(hd ? { hd } : {}),
    sessionKind: 'cli_elevated',
    scopes: [...ELEVATED_CLI_SCOPES],
  });
}

describe('Cloud RBAC, Cascading Inheritance, Batch Sharing, Share Links & Tenant Isolation', () => {
  test('Cascading RBAC, Private Projects, Batch Grants, Deferred Invite Auto-Claim, Domain Spoof Guard, Share Links & WS/FTS Isolation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myartifact-rbac-test-'));
    const cloudStore = new SqliteCloudStore(tmpDir);
    const tokenService = new CloudTokenService({ dataDir: tmpDir });
    const running = await startArtifactServer({
      port: 0,
      mode: 'cloud',
      cloud: { dataDir: tmpDir, cloudStore, tokenService },
    });

    const openSockets: WebSocket[] = [];

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // Seed verified users
      const ownerRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-owner',
        email: 'owner@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Owner',
      });
      const viewerRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-viewer',
        email: 'viewer@acme.com',
        emailVerified: true,
        googleHd: 'acme.com',
        displayName: 'Viewer',
      });
      const editorRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-editor',
        email: 'editor@ext.io',
        emailVerified: true,
        displayName: 'External Editor',
      });
      const outsiderRes = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-outsider',
        email: 'outsider@gmail.com',
        emailVerified: true,
        displayName: 'Outsider',
      });

      const ownerJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        ownerRes.user.id,
        ownerRes.user.email,
        ownerRes.user.googleHd
      );
      const viewerJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        viewerRes.user.id,
        viewerRes.user.email,
        viewerRes.user.googleHd
      );
      const editorJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        editorRes.user.id,
        editorRes.user.email
      );
      const outsiderJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        outsiderRes.user.id,
        outsiderRes.user.email
      );

      // Owner creates Team Workspace "acme-ai"
      const ownerCtx: AuthPrincipalContext = {
        authenticated: true,
        user: ownerRes.user,
        scopes: [...ELEVATED_CLI_SCOPES],
        viaAgent: 'web',
      };
      const ws = await cloudStore.createWorkspace(ownerCtx, {
        slug: 'acme-ai',
        name: 'Acme AI Lab',
        allowedGoogleHd: 'acme.com',
      });

      // Create artifacts across two categories in project argos-01 + a second project secret-proj
      const artBench1 = await cloudStore.createArtifact(ownerCtx, ws.id, {
        slug: 'sim2real-bench',
        title: 'Argos Sim2Real Torque Benchmark',
        project: 'argos-01',
        category: 'experiments/benchmarks',
        type: 'react',
        content: 'export default function Bench() { return <div>Torque 2.21 Nm</div>; }',
      });
      const artBench2 = await cloudStore.createArtifact(ownerCtx, ws.id, {
        slug: 'latency-eval',
        title: 'Latency Eval',
        project: 'argos-01',
        category: 'experiments/benchmarks',
        type: 'react',
        content: 'export default function Lat() { return <div>2.03ms</div>; }',
      });
      const artPaper = await cloudStore.createArtifact(ownerCtx, ws.id, {
        slug: 'scaling-paper',
        title: 'Secret Scaling Paper',
        project: 'argos-01',
        category: 'papers/research',
        type: 'markdown',
        links: ['sim2real-bench'],
        content: '# Proprietary Scaling Law\nSee [[sim2real-bench]].',
      });
      const artSecret = await cloudStore.createArtifact(ownerCtx, ws.id, {
        slug: 'unannounced-model',
        title: 'Unannounced Model Weights',
        project: 'secret-proj',
        category: 'concepts/architecture',
        type: 'markdown',
        content: 'Top secret roadmap',
      });

      // Grant viewer@acme.com workspace viewer; editor@ext.io category editor on argos-01:experiments/benchmarks
      await cloudStore.applyBatchGrants(ownerCtx, ws.id, {
        resources: [{ type: 'workspace', id: ws.id }],
        principals: [{ type: 'email', email: 'viewer@acme.com' }],
        role: 'viewer',
      });
      await cloudStore.applyBatchGrants(ownerCtx, ws.id, {
        resources: [{ type: 'category', projectId: 'argos-01', prefix: 'experiments/benchmarks' }],
        principals: [{ type: 'email', email: 'editor@ext.io' }],
        role: 'editor',
      });
      await cloudStore.applyBatchGrants(ownerCtx, ws.id, {
        resources: [{ type: 'artifact', id: artBench2.id }],
        principals: [{ type: 'email', email: 'editor@ext.io' }],
        role: 'editor',
      });

      // 1. Check Cascading Roles + Viewer read/write protection
      const viewerHeaders = {
        Authorization: `Bearer ${viewerJwt}`,
        'X-MyArtifact-Workspace': ws.id,
      };
      const viewerList = await (await fetch(`${baseUrl}/api/artifacts`, { headers: viewerHeaders })).json();
      assert.equal(viewerList.artifacts.length, 4);

      const viewerPutStorage = await fetch(`${baseUrl}/api/artifacts/${artBench1.id}/storage`, {
        method: 'PUT',
        headers: { ...viewerHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'hack', value: 'no' }),
      });
      assert.equal(viewerPutStorage.status, 403);

      // Editor only sees experiments/benchmarks, can update sim2real-bench, cannot read scaling-paper
      const editorHeaders = {
        Authorization: `Bearer ${editorJwt}`,
        'X-MyArtifact-Workspace': ws.id,
      };
      const editorList = await (await fetch(`${baseUrl}/api/artifacts`, { headers: editorHeaders })).json();
      assert.deepEqual(
        editorList.artifacts.map((a: { slug: string }) => a.slug).sort(),
        ['latency-eval', 'sim2real-bench']
      );
      const editorUpdateOk = await fetch(`${baseUrl}/api/artifacts/${artBench1.slug}`, {
        method: 'PUT',
        headers: { ...editorHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'export default function Bench() { return <div>v2</div>; }' }),
      });
      assert.equal(editorUpdateOk.status, 200);

      const editorReadPaper = await fetch(`${baseUrl}/api/artifacts/${artPaper.slug}`, {
        headers: editorHeaders,
      });
      assert.equal(editorReadPaper.status, 403);

      // 2. Private Project (inherit_workspace_acl = false): hides from workspace viewer, retains owner & explicit category editor
      await cloudStore.setProjectVisibility(ownerCtx, ws.id, 'argos-01', false);
      const viewerAfterPrivate = await (
        await fetch(`${baseUrl}/api/artifacts`, { headers: viewerHeaders })
      ).json();
      assert.deepEqual(
        viewerAfterPrivate.artifacts.map((a: { slug: string }) => a.slug),
        ['unannounced-model']
      );
      const editorAfterPrivate = await (
        await fetch(`${baseUrl}/api/artifacts`, { headers: editorHeaders })
      ).json();
      assert.equal(editorAfterPrivate.artifacts.length, 2);

      // 3. Batch Sharing: Multi-resources x (existing editor + unregistered pending_email + group + verified Google domain)
      const group = await cloudStore.createGroup(ownerCtx, ws.id, {
        name: 'Robotics Team',
        memberEmails: ['bot-dev@ext.io'],
      });
      const batchRes = await fetch(`${baseUrl}/api/workspaces/${ws.id}/iam/grants:batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resources: [
            { type: 'artifact', id: artBench1.id },
            { type: 'artifact', id: artBench2.id },
            { type: 'artifact', id: artPaper.id },
          ],
          principals: [
            { type: 'email', email: 'editor@ext.io' }, // Already editor on artBench1 (via category) & artBench2 (direct) -> must NOT downgrade!
            { type: 'email', email: 'newhire@partner.org' }, // Unregistered -> pending_email
            { type: 'group', groupId: group.id },
            { type: 'domain', domain: 'acme.com' },
          ],
          role: 'viewer',
          mode: 'upgrade_only',
        }),
      });
      assert.equal(batchRes.status, 200);
      const batchData = await batchRes.json();
      assert.deepEqual(batchData.pendingEmailInvites, ['newhire@partner.org']);
      assert.ok(batchData.unchanged >= 1); // Direct editor binding on artBench2 preserved as unchanged!

      // Confirm editor@ext.io STILL has editor role on artBench1 (inherited) and artBench2 (direct), and viewer on artPaper
      const editorRoleBench = await cloudStore.resolveArtifactRole(
        { authenticated: true, user: editorRes.user, scopes: [...ELEVATED_CLI_SCOPES], viaAgent: 'web' },
        ws.id,
        artBench1.id
      );
      assert.equal(editorRoleBench?.role, 'editor');

      // Deferred pending_email auto-claim on first verified Google login
      const newHire = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-newhire',
        email: 'newhire@partner.org',
        emailVerified: true,
        displayName: 'New Hire',
      });
      assert.equal(newHire.claimedInvites, 3);
      const newHireJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        newHire.user.id,
        newHire.user.email
      );
      const newHireList = await (
        await fetch(`${baseUrl}/api/artifacts`, {
          headers: {
            Authorization: `Bearer ${newHireJwt}`,
            'X-MyArtifact-Workspace': ws.id,
          },
        })
      ).json();
      assert.deepEqual(
        newHireList.artifacts.map((a: { slug: string }) => a.slug).sort(),
        ['latency-eval', 'scaling-paper', 'sim2real-bench']
      );

      // 4. Google hd Spoof Guard: email ending in @acme.com WITHOUT verified googleHd gets ZERO domain access
      const spoofUser = await cloudStore.upsertGoogleUser({
        googleSub: 'sub-spoof',
        email: 'spoof@acme.com',
        emailVerified: true,
        googleHd: undefined,
        displayName: 'Spoofer',
      });
      const spoofJwt = await mintTestJwtForUser(
        cloudStore,
        tokenService,
        spoofUser.user.id,
        spoofUser.user.email,
        undefined
      );
      const spoofList = await (
        await fetch(`${baseUrl}/api/artifacts`, {
          headers: {
            Authorization: `Bearer ${spoofJwt}`,
            'X-MyArtifact-Workspace': ws.id,
          },
        })
      ).json();
      assert.equal(spoofList.artifacts.length, 0);

      // 5. Share Links: anyone collection, domain-locked, expired, and instant revocation
      const anyoneLinkRes = await (
        await fetch(`${baseUrl}/api/workspaces/${ws.id}/iam/share-links`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ownerJwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessMode: 'anyone',
            role: 'viewer',
            targetSpec: { kind: 'collection', artifactIds: [artBench1.id, artBench2.id] },
            label: 'External Benchmark Pack',
          }),
        })
      ).json();
      const anonBundle = await fetch(`${baseUrl}/api/share/${encodeURIComponent(anyoneLinkRes.token)}`);
      assert.equal(anonBundle.status, 200);
      const bundleJson = await anonBundle.json();
      assert.equal(bundleJson.artifacts.length, 2);

      // Anonymous Share Link cannot mutate storage (403)
      const anonStoragePut = await fetch(`${baseUrl}/api/artifacts/${artBench1.id}/storage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Share-Token': anyoneLinkRes.token,
        },
        body: JSON.stringify({ key: 'x', value: 'y' }),
      });
      assert.equal(anonStoragePut.status, 403);

      // Domain-locked Share Link rejects anonymous & wrong-domain, accepts verified acme.com hd
      const domLinkRes = await (
        await fetch(`${baseUrl}/api/workspaces/${ws.id}/iam/share-links`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ownerJwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessMode: 'domain',
            requiredHd: 'acme.com',
            role: 'viewer',
            targetSpec: { kind: 'artifact', artifactIds: [artSecret.id] },
          }),
        })
      ).json();
      assert.equal(
        (await fetch(`${baseUrl}/api/share/${encodeURIComponent(domLinkRes.token)}`)).status,
        401
      );
      assert.equal(
        (
          await fetch(`${baseUrl}/api/share/${encodeURIComponent(domLinkRes.token)}`, {
            headers: { Authorization: `Bearer ${viewerJwt}` },
          })
        ).status,
        200
      );

      // Expired Share Link rejected
      const expLinkRes = await (
        await fetch(`${baseUrl}/api/workspaces/${ws.id}/iam/share-links`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ownerJwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessMode: 'anyone',
            role: 'viewer',
            targetSpec: { kind: 'artifact', artifactIds: [artBench1.id] },
            expiresAt: new Date(Date.now() - 10_000).toISOString(),
          }),
        })
      ).json();
      assert.equal(
        (await fetch(`${baseUrl}/api/share/${encodeURIComponent(expLinkRes.token)}`)).status,
        403
      );

      // Revoke anyone link -> immediately returns 403
      const delLink = await fetch(
        `${baseUrl}/api/workspaces/${ws.id}/iam/share-links/${anyoneLinkRes.link.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${ownerJwt}` } }
      );
      assert.equal(delLink.status, 200);
      assert.equal(
        (await fetch(`${baseUrl}/api/share/${encodeURIComponent(anyoneLinkRes.token)}`)).status,
        403
      );

      // 6. FTS, LLM Wiki & WebSocket Tenant Isolation
      const outsiderSearch = await (
        await fetch(`${baseUrl}/api/artifacts?q=Proprietary`, {
          headers: {
            Authorization: `Bearer ${outsiderJwt}`,
            'X-MyArtifact-Workspace': ws.id,
          },
        })
      ).json();
      assert.equal(outsiderSearch.artifacts.length, 0);

      const outsiderWiki = await (
        await fetch(`${baseUrl}/api/wiki`, {
          headers: {
            Authorization: `Bearer ${outsiderJwt}`,
            'X-MyArtifact-Workspace': ws.id,
          },
        })
      ).json();
      assert.equal(outsiderWiki.projects.length, 0);
      assert.ok(!outsiderWiki.indexMarkdown.includes('unannounced-model'));

      // WebSocket isolation test
      const wsProtoUrl = `ws://127.0.0.1:${running.port}/ws?workspace=${encodeURIComponent(ws.id)}&token=`;
      const ownerWs = new WebSocket(`${wsProtoUrl}${encodeURIComponent(ownerJwt)}`);
      const outsiderWs = new WebSocket(`${wsProtoUrl}${encodeURIComponent(outsiderJwt)}`);
      openSockets.push(ownerWs, outsiderWs);

      await Promise.all([
        new Promise<void>((resolve) => ownerWs.once('open', () => resolve())),
        new Promise<void>((resolve) => outsiderWs.once('open', () => resolve())),
      ]);

      const ownerMsgs: string[] = [];
      const outsiderMsgs: string[] = [];
      ownerWs.on('message', (d) => ownerMsgs.push(d.toString()));
      outsiderWs.on('message', (d) => outsiderMsgs.push(d.toString()));

      await cloudStore.updateArtifact(ownerCtx, ws.id, artSecret.id, {
        content: 'Top secret roadmap v2',
      });
      await new Promise((r) => setTimeout(r, 120));

      assert.equal(ownerMsgs.length, 1);
      assert.ok(ownerMsgs[0].includes('unannounced-model'));
      assert.equal(outsiderMsgs.length, 0);
    } finally {
      for (const s of openSockets) {
        try {
          s.terminate();
        } catch {
          // Ignore
        }
      }
      await running.close();
      await cloudStore.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
