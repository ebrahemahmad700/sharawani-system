-- 2.6 Routing engine
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE routing_step (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id         bigint NOT NULL REFERENCES document(id),
  seq_no              int NOT NULL CHECK (seq_no >= 1),          -- position in the document's whole trail, 1..n
  kind                step_kind NOT NULL,
  sequence_group_id   uuid NULL,                                 -- shared by all steps of one ڕیزبەندی send
  group_position      int NULL CHECK (group_position >= 1),      -- 1..N within the group; shown as "ڕیزبەندی ١ لە ٣"
  group_size          int NULL CHECK (group_size >= 1),          -- N, excluding the return leg

  from_room_id        bigint NULL REFERENCES room(id),           -- NULL only when the registry sends the first step
  to_room_id          bigint NOT NULL REFERENCES room(id),
  assigned_by         bigint NOT NULL REFERENCES app_user(id),   -- who created the step
  assigned_to         bigint NULL REFERENCES app_user(id),       -- head or delegate, resolved at activation (§3.6)
  assigned_via_delegation_id bigint NULL REFERENCES room_delegation(id),

  status              step_status NOT NULL,
  action_taken        step_action NULL,
  note                text NULL,                                 -- تێبینی بۆ ژوورەکان: the assigner's instruction
  reply_note          text NULL,                                 -- what the room wrote back, or the return reason
  due_days            int NOT NULL CHECK (due_days BETWEEN 1 AND 60),
  return_to_assigner  boolean NOT NULL DEFAULT false,            -- copied onto every step of a group when the box was ticked

  sent_at             timestamptz NULL,                          -- when the step became active
  received_at         timestamptz NULL,                          -- first open by someone in to_room
  completed_at        timestamptz NULL,                          -- done / returned / skipped / cancelled
  due_at              timestamptz NULL,                          -- sent_at + due_days (calendar days, see §15 D-9)
  completed_by        bigint NULL REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT step_seq_unique      UNIQUE (document_id, seq_no),
  CONSTRAINT step_group_shape     CHECK (
    (kind IN ('sequence', 'return_leg') AND sequence_group_id IS NOT NULL AND group_position IS NOT NULL AND group_size IS NOT NULL)
    OR (kind IN ('single', 'bounce') AND sequence_group_id IS NULL AND group_position IS NULL AND group_size IS NULL)
  ),
  CONSTRAINT step_waiting_shape   CHECK (status <> 'waiting' OR (sent_at IS NULL AND received_at IS NULL AND completed_at IS NULL AND due_at IS NULL)),
  CONSTRAINT step_active_shape    CHECK (status <> 'active'  OR (sent_at IS NOT NULL AND due_at IS NOT NULL AND completed_at IS NULL)),
  CONSTRAINT step_finished_shape  CHECK (status NOT IN ('done', 'returned') OR (sent_at IS NOT NULL AND completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CONSTRAINT step_done_has_action CHECK (status <> 'done' OR action_taken IS NOT NULL),
  CONSTRAINT step_returned_reason CHECK (status <> 'returned' OR (reply_note IS NOT NULL AND length(reply_note) >= 3)),
  CONSTRAINT step_time_order      CHECK (
    (received_at IS NULL OR sent_at IS NULL OR received_at >= sent_at)
    AND (completed_at IS NULL OR sent_at IS NULL OR completed_at >= sent_at)
  ),
  CONSTRAINT step_rooms_differ    CHECK (from_room_id IS NULL OR from_room_id <> to_room_id)
);
COMMENT ON TABLE routing_step IS 'PLAN.md §4.3. One row per hop. Produces the trail, every inbox, the overdue report and the elapsed-time figures. Rows are never deleted; rejected paths become status returned/skipped/cancelled.';

-- Invariant I-1: at most one active step per document.
CREATE UNIQUE INDEX ux_step_one_active ON routing_step (document_id) WHERE status = 'active';
-- Invariant I-2: group positions are unique within a group.
CREATE UNIQUE INDEX ux_step_group_pos  ON routing_step (sequence_group_id, group_position) WHERE sequence_group_id IS NOT NULL;

CREATE INDEX ix_step_inbox     ON routing_step (to_room_id, status, due_at) WHERE status IN ('active', 'waiting');
CREATE INDEX ix_step_assignee  ON routing_step (assigned_to) WHERE status = 'active';
CREATE INDEX ix_step_document  ON routing_step (document_id, seq_no);
CREATE INDEX ix_step_group     ON routing_step (sequence_group_id, group_position) WHERE sequence_group_id IS NOT NULL;
CREATE INDEX ix_step_overdue   ON routing_step (due_at) WHERE status = 'active';
CREATE INDEX ix_step_from_room ON routing_step (from_room_id, sent_at DESC);   -- the "ناردراوەکان" tab

ALTER TABLE document ADD CONSTRAINT fk_document_current_step FOREIGN KEY (current_step_id) REFERENCES routing_step(id);

-- Invariant I-3: only the transitions in §3.3 are legal. The application performs the transitions;
-- this trigger refuses anything else, so a bug or a hand-run UPDATE cannot corrupt a trail.
CREATE OR REPLACE FUNCTION routing_step_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'routing_step rows are never deleted (document %, step %)', OLD.document_id, OLD.id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('waiting', 'active') THEN
      RAISE EXCEPTION 'a new routing_step must be waiting or active, got %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status = NEW.status THEN
    -- same-state edits: only received_at, assigned_to, assigned_via_delegation_id, reply_note, action_taken may change while active
    IF OLD.status = 'active' AND (OLD.document_id, OLD.seq_no, OLD.to_room_id, OLD.sent_at, OLD.due_at)
                              IS DISTINCT FROM (NEW.document_id, NEW.seq_no, NEW.to_room_id, NEW.sent_at, NEW.due_at) THEN
      RAISE EXCEPTION 'immutable columns changed on active step %', OLD.id;
    END IF;
    IF OLD.status IN ('done', 'skipped', 'returned', 'cancelled') THEN
      RAISE EXCEPTION 'step % is finished (%), no further edits', OLD.id, OLD.status;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'waiting' AND NEW.status IN ('active', 'skipped', 'cancelled'))
    OR (OLD.status = 'active'  AND NEW.status IN ('done', 'returned', 'skipped', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'illegal routing_step transition % -> % on step %', OLD.status, NEW.status, OLD.id;
  END IF;
  IF NEW.status IN ('done', 'returned', 'skipped', 'cancelled') AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_routing_step_guard
  BEFORE INSERT OR UPDATE OR DELETE ON routing_step
  FOR EACH ROW EXECUTE FUNCTION routing_step_guard();
ALTER TABLE routing_step ENABLE ALWAYS TRIGGER trg_routing_step_guard;

-- Invariant I-4: document.status = in_flow  <=>  exactly one active step exists, and current_step_id points at it.
-- Checked at commit so that the multi-statement procedures in §3 can pass through intermediate states.
CREATE OR REPLACE FUNCTION document_flow_invariant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d document; doc_id bigint; n_active int; active_id bigint; active_room bigint;
BEGIN
  IF TG_TABLE_NAME = 'routing_step' THEN doc_id := NEW.document_id; ELSE doc_id := NEW.id; END IF;
  SELECT * INTO d FROM document WHERE id = doc_id;
  IF d.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), max(id), max(to_room_id) INTO n_active, active_id, active_room
    FROM routing_step WHERE document_id = d.id AND status = 'active';
  IF d.status = 'in_flow' THEN
    IF n_active <> 1 OR d.current_step_id <> active_id OR d.current_room_id <> active_room THEN
      RAISE EXCEPTION 'I-4 violated on document %: status in_flow but active steps=% current_step=% current_room=%',
        d.id, n_active, d.current_step_id, d.current_room_id;
    END IF;
  ELSIF n_active > 0 THEN
    RAISE EXCEPTION 'I-4 violated on document %: status % but % active step(s)', d.id, d.status, n_active;
  END IF;
  IF d.status IN ('closed', 'cancelled') AND EXISTS (SELECT 1 FROM routing_step WHERE document_id = d.id AND status = 'waiting') THEN
    RAISE EXCEPTION 'I-7 violated on document %: % but waiting steps remain', d.id, d.status;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_doc_flow_invariant_step
  AFTER INSERT OR UPDATE ON routing_step DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION document_flow_invariant();
CREATE CONSTRAINT TRIGGER trg_doc_flow_invariant_doc
  AFTER UPDATE OF status, current_step_id, current_room_id ON document DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION document_flow_invariant();
