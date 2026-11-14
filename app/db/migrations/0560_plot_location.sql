-- 0560 Where a plot is (نەخشەی پارچەکان).
--
-- The plot file answers "what has happened to 247/5". It could not answer "where
-- is 247/5", or "what is going on in this street", because the system had plot
-- numbers and no places. The cadastral maps are paper in the archive room and are
-- not coming into this system wholesale.
--
-- So a place is given to a plot by the people who know it: a clerk opens the plot
-- file, finds the spot on the map of Rania, and clicks. A point, and optionally
-- the outline of the plot. From then on the plot is on the map with the state of
-- its letters, and clicking it opens its file.
--
-- The map itself is streets and water from OpenStreetMap, stored as a file on
-- this server (public/map/rania.json). Nothing is fetched from anywhere else while
-- the map is in use, so where the municipality is looking is nobody else's
-- business, and the map works with the internet down.
--
-- One row per plot, keyed by the same canonical key the plot file uses, so
-- ٢٤٧/٥ and 247-5 are one place. Moving a plot updates the row; the old and new
-- positions go into the activity log, which is the history.

CREATE TABLE plot_location (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plot_no     text NOT NULL CHECK (length(btrim(plot_no)) BETWEEN 1 AND 60),
  plot_key    text GENERATED ALWAYS AS (plot_key(plot_no)) STORED UNIQUE,
  neighbourhood text NULL CHECK (neighbourhood IS NULL OR length(neighbourhood) <= 120),
  -- The Kurdistan Region, generously: a click in the sea is a mistake, not a place.
  lat         double precision NOT NULL CHECK (lat BETWEEN 34 AND 38),
  lng         double precision NOT NULL CHECK (lng BETWEEN 42 AND 47),
  -- [[lat, lng], ...], a closed ring of 3 to 200 corners, or NULL for a point only.
  outline     jsonb NULL CHECK (outline IS NULL OR (jsonb_typeof(outline) = 'array'
                                                    AND jsonb_array_length(outline) BETWEEN 3 AND 200)),
  placed_by   bigint NOT NULL REFERENCES app_user(id),
  placed_at   timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint NULL REFERENCES app_user(id),
  updated_at  timestamptz NULL
);

COMMENT ON TABLE plot_location IS
  'Where a plot is on the map, given by staff. One row per canonical plot key; moves are logged in activity_log.';

ALTER TABLE plot_location ENABLE ROW LEVEL SECURITY;

-- The plot file's readers, IT excepted as everywhere.
CREATE POLICY plot_location_select ON plot_location FOR SELECT
  USING ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                                 'room_clerk', 'registry_clerk', 'archive_clerk', 'hr'));

CREATE POLICY plot_location_insert ON plot_location FOR INSERT
  WITH CHECK ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                                      'registry_clerk', 'archive_clerk')
              AND placed_by = (SELECT app_user_id()));

CREATE POLICY plot_location_update ON plot_location FOR UPDATE
  USING ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                                 'registry_clerk', 'archive_clerk'))
  WITH CHECK (updated_by = (SELECT app_user_id()));

GRANT SELECT, INSERT ON plot_location TO docsys_app;
GRANT UPDATE (neighbourhood, lat, lng, outline, updated_by, updated_at) ON plot_location TO docsys_app;
GRANT SELECT ON plot_location TO docsys_readonly, docsys_jobs;
