-- 0320 The folder trolley.
--
-- One letter at a time is how the screens work and it is not how the building
-- works. Twice a day someone carries an armful of folders from the registry to
-- Legal, and Legal signs once for the lot. The system had no way to say that, so
-- either every folder was signed for separately, which nobody does, or none were,
-- which is what actually happened.
--
-- A manifest is that armful: one sending room, one receiving room, one named
-- courier, a list of letters, and two signatures. It gets a number of its own,
-- issued the same way document numbers are, because the whole value of a paper
-- delivery note is that you can ask for it later by number.
--
-- The courier is free text and not a user. The people who carry folders between
-- floors do not have accounts, and inventing one for them would put a name in the
-- staff list that cannot sign in and cannot be held to anything. A written name
-- on a manifest is exactly as strong as the paper it is printed on, which is what
-- it is standing in for.
--
-- Receiving a manifest stamps paper_received_at on every step in it (0300). That
-- is the point of the whole table: one action, one signature, twelve folders
-- accounted for.

CREATE TABLE dispatch_manifest (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manifest_seq   int NOT NULL CHECK (manifest_seq >= 1),
  manifest_year  int NOT NULL CHECK (manifest_year BETWEEN 2000 AND 2100),
  manifest_no    text NOT NULL UNIQUE,                    -- 'گ/2026/17', Western digits in store
  from_room_id   bigint NOT NULL REFERENCES room(id),
  to_room_id     bigint NOT NULL REFERENCES room(id),
  courier_name   text NOT NULL CHECK (length(btrim(courier_name)) BETWEEN 2 AND 120),
  note           text NULL CHECK (note IS NULL OR length(note) <= 500),
  created_by     bigint NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  received_at    timestamptz NULL,
  received_by    bigint NULL REFERENCES app_user(id),
  cancelled_at   timestamptz NULL,
  cancelled_by   bigint NULL REFERENCES app_user(id),

  CONSTRAINT manifest_unique        UNIQUE (manifest_year, manifest_seq),
  CONSTRAINT manifest_rooms_differ  CHECK (from_room_id <> to_room_id),
  CONSTRAINT manifest_receipt_shape CHECK ((received_at IS NULL) = (received_by IS NULL)),
  CONSTRAINT manifest_cancel_shape  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  -- A manifest that has been signed for cannot then be cancelled. The folders are
  -- in the other room; pretending otherwise is how a folder goes missing on paper
  -- while sitting on a desk.
  CONSTRAINT manifest_not_both      CHECK (received_at IS NULL OR cancelled_at IS NULL)
);

COMMENT ON TABLE dispatch_manifest IS
  'One physical handover of several folders from one room to another, carried by a named courier and signed for once.';
COMMENT ON COLUMN dispatch_manifest.courier_name IS
  'Written, not a user reference. Couriers do not have accounts; this stands in for a signature on paper.';

CREATE INDEX ix_manifest_to_open ON dispatch_manifest (to_room_id, created_at DESC)
  WHERE received_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX ix_manifest_from    ON dispatch_manifest (from_room_id, created_at DESC);

CREATE TABLE dispatch_item (
  manifest_id     bigint NOT NULL REFERENCES dispatch_manifest(id),
  document_id     bigint NOT NULL REFERENCES document(id),
  routing_step_id bigint NOT NULL REFERENCES routing_step(id),
  PRIMARY KEY (manifest_id, document_id)
);

COMMENT ON TABLE dispatch_item IS
  'A letter on a manifest. routing_step_id is the step being handed over, so receiving the manifest can stamp the right step.';

-- A step travels on at most one open manifest. Without this a folder can be
-- listed as in transit to two rooms at once, which on paper it cannot be.
CREATE UNIQUE INDEX ix_dispatch_item_step_once ON dispatch_item (routing_step_id);
CREATE INDEX ix_dispatch_item_document ON dispatch_item (document_id);

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------

INSERT INTO system_setting (key, value) VALUES ('manifest_no_format', '{"prefix": "گ"}')
  ON CONFLICT (key) DO NOTHING;

-- format_doc_number gains the third kind. The shape is unchanged; only the
-- setting it reads for the prefix depends on the kind.
CREATE OR REPLACE FUNCTION format_doc_number(p_kind counter_kind, p_year int, p_seq int)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT (SELECT value ->> 'prefix' FROM system_setting
           WHERE key = CASE p_kind
                         WHEN 'incoming' THEN 'incoming_no_format'
                         WHEN 'outgoing' THEN 'outgoing_no_format'
                         ELSE 'manifest_no_format'
                       END)
         || '/' || p_year::text || '/' || p_seq::text;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- A manifest header is workload information: which room sent how many folders to
-- which other room, and who carried them. The two rooms involved see it, and so
-- do the mayor, the deputy and the registry, who see everything about movement
-- already. IT does not, on the same principle as everywhere else: knowing that
-- twelve folders went from the registry to Legal on Tuesday is knowing something
-- about the letters.
--
-- The list of letters on a manifest follows the letter rule rather than the
-- manifest rule, because it names documents.

ALTER TABLE dispatch_manifest ENABLE ROW LEVEL SECURITY;

CREATE POLICY manifest_select ON dispatch_manifest FOR SELECT
  USING (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
         OR from_room_id = ANY (app_visible_rooms())
         OR to_room_id   = ANY (app_visible_rooms()));

CREATE POLICY manifest_insert ON dispatch_manifest FOR INSERT
  WITH CHECK (app_role() <> 'sysadmin' AND from_room_id = ANY (app_visible_rooms()));

CREATE POLICY manifest_update ON dispatch_manifest FOR UPDATE
  USING (app_role() <> 'sysadmin'
         AND (from_room_id = ANY (app_visible_rooms()) OR to_room_id = ANY (app_visible_rooms())));

ALTER TABLE dispatch_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispatch_item_select ON dispatch_item FOR SELECT
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY dispatch_item_insert ON dispatch_item FOR INSERT
  WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY dispatch_item_delete ON dispatch_item FOR DELETE
  USING (app_role() <> 'sysadmin' AND document_visible(document_id));

GRANT SELECT, INSERT, UPDATE ON dispatch_manifest TO docsys_app;
GRANT SELECT, INSERT, DELETE ON dispatch_item     TO docsys_app;
GRANT SELECT ON dispatch_manifest, dispatch_item  TO docsys_readonly;
GRANT SELECT ON dispatch_manifest, dispatch_item  TO docsys_jobs;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO docsys_app;
