-- 2.5 The document
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE document (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- incoming registration (هاتوو)
  incoming_seq            int NOT NULL CHECK (incoming_seq >= 1),
  incoming_year           int NOT NULL CHECK (incoming_year BETWEEN 2000 AND 2100),
  incoming_no             text NOT NULL UNIQUE,                 -- 'ه/2026/4521' canonical, Western digits
  incoming_date           date NOT NULL,                        -- بەرواری هاتن, the date on the paper register
  incoming_registered_by  bigint NOT NULL REFERENCES app_user(id),
  incoming_registered_at  timestamptz NOT NULL DEFAULT now(),

  -- outgoing registration (دەرچوو), filled at close
  outgoing_seq            int NULL CHECK (outgoing_seq >= 1),
  outgoing_year           int NULL,
  outgoing_no             text NULL UNIQUE,                     -- 'د/2026/187'
  outgoing_date           date NULL,
  outgoing_registered_by  bigint NULL REFERENCES app_user(id),
  outgoing_recipient      text NULL,                            -- بۆ کوێ دەنێردرێت
  outgoing_summary        text NULL,                            -- پوختەی وەڵام
  outgoing_channel        send_channel NULL,                    -- ڕێگای ناردن

  -- content
  subject                 text NOT NULL CHECK (length(subject) BETWEEN 3 AND 500),
  subject_search          text GENERATED ALWAYS AS (ku_normalize(subject)) STORED,
  doc_type                doc_type NOT NULL,
  sender_kind             sender_kind NOT NULL,
  sender_name             text NOT NULL,                        -- لە کوێوە هاتووە
  sender_search           text GENERATED ALWAYS AS (ku_normalize(sender_name)) STORED,
  sender_contact          text NULL,
  priority                priority_level NOT NULL DEFAULT 'normal',
  status                  document_status NOT NULL DEFAULT 'registered',

  -- where it is now: the "ئێستا لای" column. Denormalised, maintained only by the routing functions in §3.
  current_room_id         bigint NULL REFERENCES room(id),
  current_step_id         bigint NULL,                          -- FK added after routing_step exists

  -- land reference, optional
  plot_no                 text NULL,                            -- '247/5' as typed
  plot_key                text GENERATED ALWAYS AS (plot_key(plot_no)) STORED,   -- '247/5' canonical
  neighbourhood           text NULL,                            -- گەڕەک
  neighbourhood_search    text GENERATED ALWAYS AS (ku_normalize(neighbourhood)) STORED,
  related_document_id     bigint NULL REFERENCES document(id),  -- a follow-up letter about an earlier case

  -- where the paper original lives
  physical_shelf          text NULL,
  physical_folder         text NULL,
  physical_section        text NULL,

  -- legacy import (§11)
  is_legacy               boolean NOT NULL DEFAULT false,
  legacy_note             text NULL,

  cancelled_at            timestamptz NULL,
  cancelled_by            bigint NULL REFERENCES app_user(id),
  cancel_reason           text NULL,
  closed_at               timestamptz NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT doc_incoming_unique   UNIQUE (incoming_year, incoming_seq),
  CONSTRAINT doc_outgoing_unique   UNIQUE (outgoing_year, outgoing_seq),
  CONSTRAINT doc_outgoing_complete CHECK (
    (outgoing_seq IS NULL AND outgoing_year IS NULL AND outgoing_no IS NULL AND outgoing_date IS NULL AND outgoing_registered_by IS NULL)
    OR
    (outgoing_seq IS NOT NULL AND outgoing_year IS NOT NULL AND outgoing_no IS NOT NULL AND outgoing_date IS NOT NULL AND outgoing_registered_by IS NOT NULL)
  ),
  CONSTRAINT doc_closed_consistent CHECK (
    (status = 'closed') = (closed_at IS NOT NULL)
  ),
  CONSTRAINT doc_closed_has_outgoing CHECK (status <> 'closed' OR outgoing_no IS NOT NULL),
  CONSTRAINT doc_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT doc_current_room_by_status CHECK (
    (status IN ('in_flow', 'ready_to_close') AND current_room_id IS NOT NULL)
    OR (status IN ('draft', 'registered', 'closed', 'cancelled') AND current_room_id IS NULL AND current_step_id IS NULL)
  ),
  CONSTRAINT doc_step_only_in_flow CHECK (current_step_id IS NULL OR status = 'in_flow')
);
COMMENT ON TABLE document IS 'One row per official letter (کتاب). Never deleted. PLAN.md §4.2.';
COMMENT ON COLUMN document.status IS 'registered: numbered, not yet routed. in_flow: has exactly one active routing_step. ready_to_close: all steps finished, waiting for the registry to issue the outgoing number; current_room_id = the registry room. closed: outgoing issued. cancelled: number kept, shown struck through.';
COMMENT ON COLUMN document.current_room_id IS 'ئێستا لای. Maintained exclusively by the routing procedures in §3. No other code path may write it.';

CREATE INDEX ix_doc_current       ON document (current_room_id, status) WHERE status IN ('in_flow', 'ready_to_close');
CREATE INDEX ix_doc_incoming      ON document (incoming_year DESC, incoming_seq DESC);
CREATE INDEX ix_doc_outgoing      ON document (outgoing_year DESC, outgoing_seq DESC) WHERE outgoing_seq IS NOT NULL;
CREATE INDEX ix_doc_status_date   ON document (status, incoming_date DESC);
CREATE INDEX ix_doc_plot          ON document (plot_key) WHERE plot_key IS NOT NULL;
CREATE INDEX ix_doc_related       ON document (related_document_id) WHERE related_document_id IS NOT NULL;
CREATE INDEX ix_doc_subject_trgm  ON document USING gin (subject_search gin_trgm_ops);
CREATE INDEX ix_doc_sender_trgm   ON document USING gin (sender_search gin_trgm_ops);
CREATE INDEX ix_doc_nbhd_trgm     ON document USING gin (neighbourhood_search gin_trgm_ops);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_document_touch BEFORE UPDATE ON document FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
