-- 2.9 Templates, leave, sends, log
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE template (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,                          -- فۆڕمی داواکاری مۆڵەت
  category      text NOT NULL,                                 -- نامەی ناوخۆیی · داواکاری مۆڵەت · بڕیار · ئامادەبوون · داواکاری کڕین · ئاگادارکردنەوە
  description   text NULL,
  room_id       bigint NULL REFERENCES room(id),               -- owning room; NULL = available to all
  body_html     text NOT NULL,                                 -- sanitised HTML with {{field}} placeholders
  field_schema  jsonb NOT NULL DEFAULT '[]',                   -- [{"name":"employee","label":"ناوی کارمەند","type":"text","required":true}, ...]
  version       int NOT NULL DEFAULT 1,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    bigint NOT NULL REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    bigint NULL REFERENCES app_user(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_schema_is_array CHECK (jsonb_typeof(field_schema) = 'array')
);
CREATE TRIGGER trg_template_touch BEFORE UPDATE ON template FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE template_fill (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id      bigint NOT NULL REFERENCES template(id),
  template_version int NOT NULL,
  document_id      bigint NULL REFERENCES document(id),
  filled_by        bigint NOT NULL REFERENCES app_user(id),
  filled_at        timestamptz NOT NULL DEFAULT now(),
  values           jsonb NOT NULL,
  rendered_path    text NULL CHECK (rendered_path IS NULL OR rendered_path ~ '^files/\d{4}/\d{2}/[0-9a-f-]{36}\.pdf$'),
  printed_at       timestamptz NULL,
  attachment_id    bigint NULL REFERENCES attachment(id)       -- set when "attach to document" is used
);
CREATE INDEX ix_fill_template ON template_fill (template_id, filled_at DESC);
CREATE INDEX ix_fill_document ON template_fill (document_id) WHERE document_id IS NOT NULL;

CREATE TABLE leave_record (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES app_user(id),
  leave_type    leave_type NOT NULL,
  start_date    date NOT NULL,
  end_date      date NOT NULL CHECK (end_date >= start_date),
  working_days  int NOT NULL CHECK (working_days >= 1),        -- computed by the app from the working-week setting (Q7)
  status        leave_status NOT NULL DEFAULT 'requested',
  note          text NULL,
  document_id   bigint NULL REFERENCES document(id),           -- the leave request letter, if one was registered
  requested_by  bigint NOT NULL REFERENCES app_user(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    bigint NULL REFERENCES app_user(id),
  decided_at    timestamptz NULL,
  decision_note text NULL,
  cancelled_at  timestamptz NULL,
  CONSTRAINT leave_decision_pair CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX ix_leave_user   ON leave_record (user_id, start_date DESC);
CREATE INDEX ix_leave_active ON leave_record (start_date, end_date) WHERE status = 'approved';
ALTER TABLE room_delegation ADD CONSTRAINT fk_delegation_leave FOREIGN KEY (leave_record_id) REFERENCES leave_record(id);
COMMENT ON TABLE leave_record IS 'مۆڵەت. Approval chain is single-step in v1 (§15 D-10, pending Q7). Approving a room head''s leave writes a room_delegation row (§3.6).';

CREATE TABLE external_send (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id           bigint NOT NULL REFERENCES document(id),
  channel               send_channel NOT NULL,
  recipient_name        text NOT NULL,
  recipient_address     text NULL,                             -- email address, phone in E.164, or postal text
  subject               text NULL,
  body                  text NULL,
  attachment_ids        bigint[] NOT NULL DEFAULT '{}',
  sent_by               bigint NOT NULL REFERENCES app_user(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  sent_at               timestamptz NULL,
  status                send_status NOT NULL DEFAULT 'queued',
  attempts              int NOT NULL DEFAULT 0,
  error_text            text NULL,
  response_received_at  timestamptz NULL,
  response_attachment_id bigint NULL REFERENCES attachment(id)
);
CREATE INDEX ix_send_document ON external_send (document_id, created_at DESC);
CREATE INDEX ix_send_queue    ON external_send (status, created_at) WHERE status IN ('queued', 'failed');
COMMENT ON COLUMN external_send.channel IS 'whatsapp in v1 is a link handoff (PLAN.md §14): status goes straight to sent when the staff member confirms they pressed send.';

CREATE TABLE activity_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  user_id       bigint NULL REFERENCES app_user(id),           -- NULL for system jobs (tray watcher, leave rollover)
  room_id       bigint NULL REFERENCES room(id),
  document_id   bigint NULL REFERENCES document(id),
  archive_file_id bigint NULL REFERENCES archive_file(id),
  action        text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),   -- 'step.completed'; full list in §2.13
  detail        jsonb NOT NULL DEFAULT '{}',
  ip_address    inet NULL,
  user_agent    text NULL,
  session_id    uuid NULL
);
CREATE INDEX ix_log_time     ON activity_log (occurred_at DESC);
CREATE INDEX ix_log_document ON activity_log (document_id, occurred_at) WHERE document_id IS NOT NULL;
CREATE INDEX ix_log_user     ON activity_log (user_id, occurred_at DESC);
CREATE INDEX ix_log_room     ON activity_log (room_id, occurred_at DESC) WHERE room_id IS NOT NULL;
CREATE INDEX ix_log_action   ON activity_log (action, occurred_at DESC);
COMMENT ON TABLE activity_log IS 'تۆماری چالاکی. Append-only at the database level (PLAN.md §3.2 rule). detail never contains subject text or names; only ids, numbers, statuses. This is what lets IT read the log without reading letters.';

-- Append-only: refuse UPDATE, DELETE and TRUNCATE for every role, including the owner. Belt (trigger) and braces (grants, §2.11).
CREATE OR REPLACE FUNCTION activity_log_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only (% refused)', TG_OP;
END $$;
CREATE TRIGGER trg_log_no_update   BEFORE UPDATE OR DELETE ON activity_log FOR EACH STATEMENT EXECUTE FUNCTION activity_log_block();
CREATE TRIGGER trg_log_no_truncate BEFORE TRUNCATE          ON activity_log FOR EACH STATEMENT EXECUTE FUNCTION activity_log_block();
ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_no_update;
ALTER TABLE activity_log ENABLE ALWAYS TRIGGER trg_log_no_truncate;

CREATE TABLE assistant_conversation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          bigint NOT NULL REFERENCES app_user(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  backend          text NOT NULL                                -- 'local:qwen3-14b' | 'hosted:qwen3-235b' | 'anthropic:claude-sonnet-5' | 'rules'
);
CREATE INDEX ix_conv_user ON assistant_conversation (user_id, last_message_at DESC);

CREATE TABLE assistant_message (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id          uuid NOT NULL REFERENCES assistant_conversation(id),
  role                     assistant_role NOT NULL,
  content                  text NULL,                            -- user question or assistant answer
  tool_name                text NULL,                            -- for role = tool
  tool_args                jsonb NULL,
  tool_row_count           int NULL,
  input_tokens             int NULL,
  output_tokens            int NULL,
  cache_read_input_tokens  int NULL,                             -- PLAN.md §7.6: must be non-zero on hosted backends after the first call
  latency_ms               int NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_msg_conv ON assistant_message (conversation_id, id);

-- schema_migration is created by the migration runner (db/migrate.mjs) rather
-- than here, because the runner needs it before the first migration can run.
-- Its shape is exactly as this plan specified: version, applied_at, checksum.
