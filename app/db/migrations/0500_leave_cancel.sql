-- A leave can be cancelled after it was approved (records test, 13 September:
-- a leave entered with the wrong dates stood for ever and blocked the corrected
-- request). The old rule tied "decided" to approved/rejected alone, so a
-- cancelled leave had to forget who approved it. Now a cancelled leave keeps its
-- decision if it had one, and records when it was cancelled.

ALTER TABLE leave_record DROP CONSTRAINT leave_decision_pair;
ALTER TABLE leave_record ADD CONSTRAINT leave_decision_pair CHECK (
  CASE status
    WHEN 'approved'  THEN decided_by IS NOT NULL AND decided_at IS NOT NULL
    WHEN 'rejected'  THEN decided_by IS NOT NULL AND decided_at IS NOT NULL
    WHEN 'requested' THEN decided_by IS NULL AND decided_at IS NULL
    ELSE (decided_by IS NULL) = (decided_at IS NULL)
  END
);
ALTER TABLE leave_record ADD CONSTRAINT leave_cancelled_at CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));
