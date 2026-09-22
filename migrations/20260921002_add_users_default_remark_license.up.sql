-- The license URI applied to every bio.lexicons.temp.v0-1.remark record this
-- user writes. Set on /app/account and stamped onto the record server-side, so
-- a survey draft queued offline picks up whatever default is in force when it
-- finally uploads. NULL means the user has never chosen one; callers fall back
-- to DEFAULT_REMARK_LICENSE in src/lib/licenses.ts.
--
-- Safe against tap identity events: insertUser upserts only handle and
-- avatar_url, so it never clobbers this column.
ALTER TABLE users ADD COLUMN default_remark_license TEXT;
