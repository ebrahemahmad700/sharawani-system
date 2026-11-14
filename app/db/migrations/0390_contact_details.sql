-- 0390 Who to ring.
--
-- The system can say a letter is with the legal room and cannot say how to reach
-- the legal room. That is the first thing anyone wants once they know where
-- their paper is, and the answer currently lives on a printed sheet taped to a
-- wall near the switchboard.
--
-- Two places, because they are two different facts. A room has a extension and
-- sits under a directorate; a person has their own extension and a job title
-- that is finer than their role. The mayor's role is 'mayor'; his title on a
-- letter is not.
--
-- All of it is optional and all of it starts empty. The real extension list has
-- not been read off that wall yet, and inventing numbers would be worse than
-- blank fields: a wrong extension is rung and a blank one is asked about. IT
-- fills them in from the staff screens as the list is confirmed.

ALTER TABLE room
  ADD COLUMN phone_extension text NULL CHECK (phone_extension IS NULL OR phone_extension ~ '^[0-9+()/ -]{2,20}$'),
  ADD COLUMN department      text NULL CHECK (department IS NULL OR length(department) <= 120),
  ADD COLUMN floor_label     text NULL CHECK (floor_label IS NULL OR length(floor_label) <= 40);

COMMENT ON COLUMN room.phone_extension IS
  'Internal extension. Digits and the punctuation a written extension carries, nothing else, so it cannot become a sentence.';
COMMENT ON COLUMN room.department IS
  'The directorate this room answers to, written out. Separate from directorate_id, which is a link that may be NULL while the name on the door is still known.';
COMMENT ON COLUMN room.floor_label IS
  'Where in the building. "نهۆمی دووەم". For the person carrying the folder.';

ALTER TABLE app_user
  ADD COLUMN phone_extension text NULL CHECK (phone_extension IS NULL OR phone_extension ~ '^[0-9+()/ -]{2,20}$'),
  ADD COLUMN job_title       text NULL CHECK (job_title IS NULL OR length(job_title) <= 120);

COMMENT ON COLUMN app_user.job_title IS
  'The title this person is addressed by, which is finer than their role. A role decides permissions; a title appears on a letter.';

-- Nothing is seeded. See the note at the top: a blank field gets asked about and
-- a wrong one gets rung.
