-- Tracker event log. Idempotent: safe to run on every deploy.
--
-- Muse (Luna) appends events through POST /log. `data` is stored as-is;
-- Muse owns its shape (see tracker-api-contract.md). The API interprets it
-- for the dashboard at read time.

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  tracker     TEXT NOT NULL CHECK (tracker IN ('life', 'food', 'skin')),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ          -- soft delete; rows are never hard-deleted
);

CREATE INDEX IF NOT EXISTS events_tracker_at_idx ON events (tracker, at) WHERE deleted_at IS NULL;

-- Rows synced from the Google Sheet carry data.sheet_row_id so re-syncing
-- updates them in place instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS events_sheet_row_idx ON events ((data->>'sheet_row_id'))
  WHERE data ? 'sheet_row_id';

-- Tell listeners (the API) that data changed so the dashboard refreshes live.
CREATE OR REPLACE FUNCTION events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('events_changed', json_build_object(
    'op', TG_OP,
    'id', COALESCE(NEW.id, OLD.id),
    'tracker', COALESCE(NEW.tracker, OLD.tracker)
  )::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_notify_trg ON events;
CREATE TRIGGER events_notify_trg
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_notify();

-- Last result of each sync source (e.g. the Google Sheet push), so the
-- dashboard can show whether syncing is healthy.
CREATE TABLE IF NOT EXISTS sync_status (
  name       TEXT PRIMARY KEY,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  result     JSONB NOT NULL DEFAULT '{}'::jsonb
);
