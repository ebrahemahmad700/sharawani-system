-- 0470 Scanners the system can drive.
--
-- Requested from the demo: "add scanner devices". Until now a scan reached the
-- system in one of two ways, both of them indirect: the scanner saved a file and
-- somebody uploaded it, or the scanner saved into a watched folder and the tray
-- picked it up. Neither lets a clerk stand at a letter's page and press "scan".
--
-- Almost every office scanner and multifunction printer sold in the last eight
-- years speaks eSCL, the protocol behind Apple AirScan and Mopria: plain HTTP on
-- the local network, a request to start a job, a request for each page. The
-- server can drive one directly, with no driver on anybody's computer and no
-- software to install. That is what this table describes.
--
-- A scanner is equipment, not correspondence, so any signed-in person may see the
-- list. Only IT, the mayor and the deputy may add or change one, because the
-- address is somewhere the server will send requests.

CREATE TABLE scanner (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,30}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  -- The eSCL root, for example http://192.168.1.40/eSCL. Checked again in the
  -- application, which refuses anything that is not on the local network.
  base_url      text NOT NULL CHECK (base_url ~ '^https?://[^/\s?#]+(/[^\s?#]*)?$' AND length(base_url) <= 300),
  room_id       bigint NULL REFERENCES room(id),
  is_active     boolean NOT NULL DEFAULT true,
  make_model    text NULL,
  last_seen_at  timestamptz NULL,
  last_error    text NULL,
  created_by    bigint NULL REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE scanner IS
  'Network scanners driven over eSCL (AirScan / Mopria). room_id NULL means the scanner is shared by the whole building.';

ALTER TABLE scanner ENABLE ROW LEVEL SECURITY;

CREATE POLICY scanner_select ON scanner FOR SELECT
  USING (app_user_id() IS NOT NULL);

CREATE POLICY scanner_insert ON scanner FOR INSERT
  WITH CHECK (app_role() IN ('sysadmin', 'mayor', 'deputy_mayor'));

-- Recording that a scanner answered is done by whoever pressed scan, so the two
-- status columns are writable by anyone signed in. Everything else is the admins'.
CREATE POLICY scanner_update ON scanner FOR UPDATE
  USING (app_user_id() IS NOT NULL);

GRANT SELECT, INSERT ON scanner TO docsys_app;
GRANT UPDATE (name, base_url, room_id, is_active, make_model, last_seen_at, last_error) ON scanner TO docsys_app;
GRANT SELECT ON scanner TO docsys_jobs, docsys_readonly;

-- The column grant above lets any signed-in user touch the configuration columns
-- too, and a policy cannot tell columns apart. So the configuration is guarded by
-- a trigger instead: a non-admin may record that a scanner answered, and nothing
-- else.
CREATE OR REPLACE FUNCTION scanner_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(app_role()::text, '') NOT IN ('sysadmin', 'mayor', 'deputy_mayor')
     AND (NEW.name, NEW.base_url, NEW.room_id, NEW.is_active, NEW.code)
         IS DISTINCT FROM (OLD.name, OLD.base_url, OLD.room_id, OLD.is_active, OLD.code) THEN
    RAISE EXCEPTION 'only IT, the mayor or the deputy may change a scanner''s configuration'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scanner_guard BEFORE UPDATE ON scanner
  FOR EACH ROW EXECUTE FUNCTION scanner_guard();
