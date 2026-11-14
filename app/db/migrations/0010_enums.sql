-- 2.2 Enumerated types
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

CREATE TYPE room_kind         AS ENUM ('registry', 'office', 'archive', 'executive');
CREATE TYPE user_role         AS ENUM ('mayor', 'deputy_mayor', 'directorate_head', 'room_head',
                                       'room_clerk', 'registry_clerk', 'archive_clerk', 'hr', 'sysadmin');
CREATE TYPE counter_kind      AS ENUM ('incoming', 'outgoing');
CREATE TYPE doc_type          AS ENUM ('citizen_request', 'company_request', 'gov_letter', 'internal',
                                       'complaint', 'report', 'contract', 'leave_request', 'other');
CREATE TYPE sender_kind       AS ENUM ('citizen', 'company', 'government', 'internal');
CREATE TYPE priority_level    AS ENUM ('normal', 'urgent', 'very_urgent');            -- ئاسایی · پەلە · زۆر پەلە
CREATE TYPE document_status   AS ENUM ('draft', 'registered', 'in_flow', 'ready_to_close', 'closed', 'cancelled');
CREATE TYPE step_kind         AS ENUM ('single', 'sequence', 'return_leg', 'bounce');
CREATE TYPE step_status       AS ENUM ('waiting', 'active', 'done', 'skipped', 'returned', 'cancelled');
CREATE TYPE step_action       AS ENUM ('opinion', 'approved', 'rejected', 'forwarded', 'letter_attached',
                                       'handwritten_reply', 'no_action');
CREATE TYPE attachment_kind   AS ENUM ('original_scan', 'handwritten_reply', 'attached_letter', 'drawing',
                                       'supporting', 'outgoing_copy');
CREATE TYPE archive_file_type AS ENUM ('dwg', 'dxf', 'pdf', 'jpg', 'png', 'tif');
CREATE TYPE leave_type        AS ENUM ('annual', 'sick', 'necessity', 'unpaid');   -- ساڵانە · نەخۆشی · پێویستی · بێ مووچە
CREATE TYPE leave_status      AS ENUM ('requested', 'approved', 'rejected', 'cancelled');
CREATE TYPE send_channel      AS ENUM ('email', 'whatsapp', 'post', 'hand');        -- ئیمەیڵ · واتسئاپ · پۆست · بە دەست
CREATE TYPE send_status       AS ENUM ('queued', 'sent', 'failed', 'delivered');
CREATE TYPE tray_status       AS ENUM ('new', 'claimed', 'archived');
CREATE TYPE batch_status      AS ENUM ('open', 'scanned', 'indexed', 'qc_passed', 'qc_failed', 'closed');
CREATE TYPE assistant_role    AS ENUM ('user', 'assistant', 'tool');
