BEGIN;

ALTER TABLE gcims.users
  ADD COLUMN auth_token_version INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_users_auth_token_version_nonnegative
    CHECK (auth_token_version >= 0);

COMMIT;
