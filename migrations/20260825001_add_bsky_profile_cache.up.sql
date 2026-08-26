ALTER TABLE users ADD COLUMN bsky_display_name TEXT;
ALTER TABLE users ADD COLUMN bsky_description TEXT;
ALTER TABLE users ADD COLUMN bsky_profile_fetched_at TIMESTAMPTZ;
