-- Short-lived, single-use codes exchanged for an app_token in the native OAuth
-- handoff.
--
-- Why not hand the token straight back? The native app receives the OAuth
-- callback through a custom URL scheme (bio.cuanto.app://), and on iOS a custom
-- scheme can be claimed by any installed app. A token in that redirect would be
-- readable by an app that registered the same scheme. A code is useless on its
-- own: redeeming it also requires the PKCE verifier, which never leaves the app
-- that started the flow.
--
-- Same reasoning as RFC 7636, applied to our own handoff rather than to the
-- upstream PDS authorization.
CREATE TABLE app_token_codes (
  -- SHA-256 of the code, for the same reason app_tokens stores a hash: a
  -- database dump must not yield redeemable credentials.
  code_hash    TEXT         PRIMARY KEY,
  did          TEXT         NOT NULL,
  -- SHA-256 of the app's PKCE verifier, supplied when the flow started. The
  -- exchange must present a verifier that hashes to this.
  challenge    TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Deliberately short: the code is redeemed within a second or two of the
  -- system browser handing control back to the app.
  expires_at   TIMESTAMPTZ  NOT NULL,
  -- Set on redemption. Kept rather than deleted so a replayed code can be told
  -- apart from an unknown one in logs; rows are swept by expiry, not on use.
  consumed_at  TIMESTAMPTZ
);

-- Expired and consumed rows are dead weight; this supports the sweep.
CREATE INDEX app_token_codes_expires_at_idx ON app_token_codes (expires_at);
