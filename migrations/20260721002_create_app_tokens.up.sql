-- Bearer tokens for non-browser clients (the Capacitor iOS app). The app loads
-- from capacitor://localhost and calls https://cuanto.bio, so the `did` cookie
-- is cross-site and WKWebView drops it.
--
-- These carry exactly the same authority as the `did` cookie: both are opaque
-- identifiers naming a DID whose real OAuth session (including DPoP keys) lives
-- in oauth_sessions. Nothing here touches the PDS session layer.
--
-- Only the SHA-256 of the token is stored. A leaked database dump must not
-- yield usable credentials, so the plaintext exists solely in the response that
-- issues it and in the client's keychain.
CREATE TABLE app_tokens (
  token_hash   TEXT         PRIMARY KEY,
  did          TEXT         NOT NULL,
  -- Free-text note about where the token was issued (device name, "ios-app"),
  -- so a future "sign out this device" UI has something to show.
  label        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Bumped on use so an idle token can be aged out and so a revocation UI can
  -- show "last seen". Deliberately not an exact audit log.
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ  NOT NULL,
  revoked_at   TIMESTAMPTZ
);

-- "Show/revoke all my tokens" is the only query shape besides the by-hash
-- primary key lookup on every authenticated request.
CREATE INDEX app_tokens_did_idx ON app_tokens (did);
