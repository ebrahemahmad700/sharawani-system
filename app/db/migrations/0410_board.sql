-- 0410 The wall board.
--
-- A screen in the corridor outside the mayor's office, showing the municipality
-- working. Nobody signs in to it and nobody clicks it; it hangs there and
-- updates itself.
--
-- Which makes it the most exposed surface in the whole system. It is read by
-- whoever walks past, including the people whose letters are in it, and the
-- machine driving it sits in a corridor where anyone could unplug the browser
-- and type a different address. So the rule here is the same one the public
-- tracking page follows, and for the same reason:
--
--   THE FILTERING LIVES IN THIS FUNCTION, NOT IN THE PAGE.
--
-- board_snapshot() is the only thing the board can reach. It returns counts,
-- room names and letter numbers. There is no argument you can pass it and no
-- column it can be persuaded to return that yields a subject line, a citizen's
-- name, a sender, or a note. If somebody later builds a prettier board, it still
-- cannot show any of those, because there is no door to them.
--
-- Letter numbers are included deliberately. A number is already printed on the
-- citizen's own receipt and on the outside of the folder; it says that the
-- municipality is working without saying what about.

/*
 * Everything the board shows, in one call.
 *
 * SECURITY DEFINER because the board has no signed-in user at all, so
 * row-level security would hide every row from it, which is correct for every
 * other door and useless for this one.
 */
CREATE OR REPLACE FUNCTION board_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),

    -- The day's figures, as the mayor's dashboard counts them.
    'today', (
      SELECT jsonb_build_object(
        'registered', count(*) FILTER (WHERE d.incoming_date = current_date),
        'closed',     count(*) FILTER (WHERE d.outgoing_date = current_date),
        'in_flow',    count(*) FILTER (WHERE d.status = 'in_flow'),
        'late',       (SELECT count(*) FROM routing_step s
                        WHERE s.status = 'active' AND s.due_at < now())
      ) FROM document d
    ),

    -- One tile per room: what it is holding and how much of that is late.
    -- Busiest first, and the ones holding nothing last. A wall board is read
    -- from across a corridor and the eye gets about two seconds: the rooms that
    -- need something must be in the first row, not in alphabetical order
    -- somewhere in the middle.
    'rooms', coalesce((
      SELECT jsonb_agg(t ORDER BY t.late DESC, t.open DESC, t.sort_order, t.name)
        FROM (
          SELECT r.name,
                 r.room_number,
                 r.sort_order,
                 count(s.id) FILTER (WHERE s.status = 'active')                        AS open,
                 count(s.id) FILTER (WHERE s.status = 'active' AND s.due_at < now())   AS late,
                 count(s.id) FILTER (WHERE s.status = 'active'
                                       AND s.paper_received_at IS NULL)                AS paper_waiting
            FROM room r
            LEFT JOIN routing_step s ON s.to_room_id = r.id
           WHERE r.is_active
           GROUP BY r.id, r.name, r.room_number, r.sort_order
        ) t
    ), '[]'::jsonb),

    -- What just happened. Action codes and ids; the page turns those into
    -- Kurdish. No detail object is returned, because a detail object is a place
    -- somebody could later put something that does not belong on a wall.
    'recent', coalesce((
      SELECT jsonb_agg(e ORDER BY e.occurred_at DESC)
        FROM (
          SELECT l.occurred_at,
                 l.action,
                 d.incoming_no,
                 r.name AS room_name
            FROM activity_log l
            LEFT JOIN document d ON d.id = l.document_id
            LEFT JOIN room     r ON r.id = l.room_id
           WHERE l.action IN ('document.registered', 'document.closed', 'document.cancelled',
                              'step.sent', 'step.received', 'step.completed', 'step.returned',
                              'manifest.created', 'manifest.received', 'step.paper_received')
             AND l.occurred_at > now() - interval '12 hours'
           ORDER BY l.occurred_at DESC
           LIMIT 14
        ) e
    ), '[]'::jsonb)
  );
$fn$;

COMMENT ON FUNCTION board_snapshot() IS
  'Everything the corridor wall board may know: counts, room names, letter numbers. Never a subject, a sender or a name.';

GRANT EXECUTE ON FUNCTION board_snapshot() TO docsys_app;
