export const CLOUD_SCHEMA_SQL = `-- MyArtifact Cloud Schema (PostgreSQL 16+)
-- Multi-tenant workspaces, Google OIDC identity, cascading RBAC, batch sharing,
-- FTS search, content-addressed blob references, and dual-attribution audit log.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  google_hd TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  slug CITEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_google_hd TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug CITEXT NOT NULL,
  name TEXT NOT NULL,
  inherit_workspace_acl BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug CITEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_email CITEXT NOT NULL,
  added_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, member_email)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_kind TEXT NOT NULL CHECK (session_kind IN ('web', 'cli_delegated', 'cli_elevated')),
  refresh_token_hash TEXT UNIQUE NOT NULL,
  prev_refresh_token_hash TEXT,
  prev_grace_until TIMESTAMPTZ,
  scope_ceiling TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_prev_hash ON auth_sessions(prev_refresh_token_hash)
  WHERE prev_refresh_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  flow_kind TEXT NOT NULL CHECK (flow_kind IN ('web', 'cli_loopback')),
  redirect_uri TEXT NOT NULL,
  cli_challenge TEXT,
  cli_redirect_uri TEXT,
  cli_state TEXT,
  elevate BOOLEAN NOT NULL DEFAULT FALSE,
  requested_workspace TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cli_auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  elevate BOOLEAN NOT NULL DEFAULT FALSE,
  default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  device_label TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_auth_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  elevate BOOLEAN NOT NULL DEFAULT FALSE,
  default_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  device_label TEXT NOT NULL DEFAULT '',
  interval_sec INTEGER NOT NULL DEFAULT 2,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug CITEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT 'user',
  project_slug CITEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  links_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  icon TEXT NOT NULL DEFAULT '',
  current_version INTEGER NOT NULL DEFAULT 1,
  current_blob_sha256 TEXT NOT NULL,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_email TEXT NOT NULL DEFAULT '',
  search_tsv TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_ws_project ON artifacts(workspace_id, project_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_search ON artifacts USING GIN(search_tsv);

CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  agent TEXT NOT NULL DEFAULT 'user',
  summary TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artifact_id, version)
);

CREATE TABLE IF NOT EXISTS artifact_kv_store (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artifact_id, key)
);

CREATE TABLE IF NOT EXISTS tb_scalars (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  step INTEGER NOT NULL,
  epoch DOUBLE PRECISION,
  value DOUBLE PRECISION NOT NULL,
  wall_time DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (artifact_id, tag, step)
);

CREATE TABLE IF NOT EXISTS tb_checkpoints (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  run_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  epoch DOUBLE PRECISION,
  object_key TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'pt',
  byte_size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_best BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_bindings (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'pending_email', 'group', 'domain')),
  principal_key TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('workspace', 'project', 'category', 'artifact')),
  resource_key TEXT NOT NULL,
  role_rank SMALLINT NOT NULL CHECK (role_rank IN (10, 20, 30, 40)),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, principal_type, principal_key, resource_type, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_role_bindings_lookup
  ON role_bindings(workspace_id, resource_type, resource_key, principal_type, principal_key);
CREATE INDEX IF NOT EXISTS idx_role_bindings_pending_email
  ON role_bindings(principal_type, principal_key) WHERE principal_type = 'pending_email';

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('anyone', 'domain')),
  required_hd TEXT,
  role_rank SMALLINT NOT NULL CHECK (role_rank IN (10, 20)),
  target_spec_json JSONB NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  via_agent TEXT NOT NULL DEFAULT 'web',
  auth_session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_ws_time ON audit_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cloud_blobs (
  key TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
