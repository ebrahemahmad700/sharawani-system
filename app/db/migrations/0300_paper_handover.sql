-- 0300 The paper arriving is not the same event as the screen saying it was sent.
--
-- Until now a step had one arrival timestamp, received_at, and it meant "somebody
-- in the receiving room opened this on screen". That is a useful thing to know
-- and it is not the thing anyone in the building actually worries about. What
-- they worry about is the folder. The registry sends a letter to Legal at ten in
-- the morning; the system says Legal has it; the folder is still in a tray by the
-- photocopier at four in the afternoon. Both statements were true and only one of
-- them mattered.
--
-- So the two events are now recorded separately:
--
--   received_at         someone in the room opened it on screen
--   paper_received_at   someone in the room has the physical folder in their hand
--
-- A step can have either without the other, and the gap between them is the
-- number worth watching: it is the time the paper spent in a corridor. A step
-- that is complete on screen but was never signed for on paper is exactly the
-- case that used to go unnoticed, and now it is a column.
--
-- paper_received_by is who signed for it, not who the step was assigned to. The
-- head is at a meeting, the clerk takes the folder; the clerk's name is the true
-- answer to "who had it".

ALTER TABLE routing_step
  ADD COLUMN paper_received_at timestamptz NULL,
  ADD COLUMN paper_received_by bigint NULL REFERENCES app_user(id),
  ADD COLUMN paper_handed_by   text NULL,      -- the courier named on the manifest, if it came by one
  ADD CONSTRAINT step_paper_shape CHECK (
    (paper_received_at IS NULL AND paper_received_by IS NULL)
    OR (paper_received_at IS NOT NULL AND paper_received_by IS NOT NULL)
  );

COMMENT ON COLUMN routing_step.received_at IS
  'When someone in the receiving room first opened this step on screen.';
COMMENT ON COLUMN routing_step.paper_received_at IS
  'When someone in the receiving room signed for the physical folder. Independent of received_at: either can happen without the other.';
COMMENT ON COLUMN routing_step.paper_received_by IS
  'Who actually took the folder, which is often the clerk rather than the person the step is assigned to.';
COMMENT ON COLUMN routing_step.paper_handed_by IS
  'The courier who carried it, when it arrived on a dispatch manifest. Free text: couriers are not system users.';

-- The steps whose paper has not turned up. Ordered oldest first, because the one
-- sent longest ago is the one to go looking for.
CREATE INDEX ix_step_paper_pending
  ON routing_step (to_room_id, sent_at)
  WHERE status = 'active' AND paper_received_at IS NULL;
