-- 2.3 Organisation, users, sessions
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TABLE directorate (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
  name          text NOT NULL,                        -- بەڕێوەبەرایەتی خزمەتگوزاری
  head_user_id  bigint NULL,                          -- FK added after app_user exists
  sort_order    int  NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE directorate IS 'بەڕێوەبەرایەتی. Optional grouping of rooms. Pending PLAN.md Q2; the table exists either way and may hold one row.';

CREATE TABLE room (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directorate_id   bigint NULL REFERENCES directorate(id),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{1,16}$'),   -- 'LEGAL', 'REGISTRY', 'PLAN_8', 'CONTRACTS_14'
  name             text NOT NULL,                     -- ژووری یاسا
  room_number      text NULL,                         -- '8', '9', '14', '8/A'. Text on purpose.
  kind             room_kind NOT NULL DEFAULT 'office',
  head_user_id     bigint NULL,                       -- FK added below
  deputy_user_id   bigint NULL,                       -- receives when head is on leave (PLAN.md §5.7)
  default_due_days int NOT NULL DEFAULT 3 CHECK (default_due_days BETWEEN 1 AND 60),
  clerk_can_forward boolean NOT NULL DEFAULT false,   -- the ○ in PLAN.md §3.2
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 100
);
COMMENT ON TABLE room IS 'ژوور. Rooms are data, never code (PLAN.md §13). Exactly one active row has kind = registry and exactly one has kind = executive.';
COMMENT ON COLUMN room.clerk_can_forward IS 'When false, a room_clerk may act on a letter but only the head or delegate may complete or forward the step.';

CREATE TABLE app_user (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username             text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name            text NOT NULL,                 -- هێمن ڕەشید
  full_name_search     text GENERATED ALWAYS AS (ku_normalize(full_name)) STORED,
  password_hash        text NOT NULL,                 -- argon2id; never bcrypt with cost < 12
  role                 user_role NOT NULL,
  room_id              bigint NULL REFERENCES room(id),
  phone                text NULL,
  email                text NULL CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+$'),
  must_change_password boolean NOT NULL DEFAULT true,
  is_active            boolean NOT NULL DEFAULT true,
  failed_login_count   int NOT NULL DEFAULT 0,
  locked_until         timestamptz NULL,
  last_login_at        timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           bigint NULL REFERENCES app_user(id),
  CONSTRAINT user_room_required CHECK (
    (role IN ('sysadmin') AND room_id IS NULL) OR (role NOT IN ('sysadmin') AND room_id IS NOT NULL)
  )
);
COMMENT ON COLUMN app_user.room_id IS 'Every non-IT user belongs to exactly one room. The mayor and deputy belong to the executive room. Registry clerks to the registry room. HR to the administration room.';
CREATE INDEX ix_user_room ON app_user (room_id) WHERE is_active;
CREATE INDEX ix_user_name_trgm ON app_user USING gin (full_name_search gin_trgm_ops);

ALTER TABLE directorate ADD CONSTRAINT fk_directorate_head FOREIGN KEY (head_user_id) REFERENCES app_user(id);
ALTER TABLE room ADD CONSTRAINT fk_room_head   FOREIGN KEY (head_user_id)   REFERENCES app_user(id);
ALTER TABLE room ADD CONSTRAINT fk_room_deputy FOREIGN KEY (deputy_user_id) REFERENCES app_user(id);
ALTER TABLE room ADD CONSTRAINT room_deputy_not_head CHECK (deputy_user_id IS DISTINCT FROM head_user_id);
CREATE UNIQUE INDEX ux_room_single_registry  ON room ((kind)) WHERE kind = 'registry'  AND is_active;
CREATE UNIQUE INDEX ux_room_single_executive ON room ((kind)) WHERE kind = 'executive' AND is_active;

CREATE TABLE user_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint NOT NULL REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip_address    inet NULL,
  user_agent    text NULL,
  revoked_at    timestamptz NULL,
  revoked_reason text NULL                            -- 'logout' | 'idle' | 'system_lock' | 'admin' | 'password_change'
);
CREATE INDEX ix_session_user ON user_session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_session_expiry ON user_session (expires_at) WHERE revoked_at IS NULL;
COMMENT ON TABLE user_session IS 'Server-side sessions. The cookie carries only the uuid. The system lock (PLAN.md §7.5) revokes every row whose user is not the mayor.';

CREATE TABLE room_delegation (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id            bigint NOT NULL REFERENCES room(id),
  absent_user_id     bigint NOT NULL REFERENCES app_user(id),     -- the head who is away
  delegate_user_id   bigint NOT NULL REFERENCES app_user(id),     -- who covers
  starts_on          date NOT NULL,
  ends_on            date NOT NULL CHECK (ends_on >= starts_on),
  leave_record_id    bigint NULL,                                  -- FK added after leave_record exists
  reason             text NULL,
  created_by         bigint NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  ended_early_at     timestamptz NULL,                             -- set when the leave is cancelled or the head returns early
  CONSTRAINT delegation_distinct CHECK (absent_user_id <> delegate_user_id)
);
CREATE INDEX ix_delegation_room_dates ON room_delegation (room_id, starts_on, ends_on) WHERE ended_early_at IS NULL;
COMMENT ON TABLE room_delegation IS 'One row per period during which a delegate receives a room''s letters. Written automatically on leave approval (§3.6) and manually by M/DM/HR.';
