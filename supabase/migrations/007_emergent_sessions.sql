-- Interleave v1 — §7: session length becomes emergent
--
-- "Session length is emergent. No block-duration parameter exists: a block lasts
-- however long it takes fatigue accumulation plus urgency drift to overcome ε."
--
-- `default_session_minutes` was that parameter. It is removed rather than ignored:
-- a column the scheduler does not read but the UI still shows is an invitation to
-- wire it back in, and it would silently reintroduce a clock into a decision the
-- spec puts entirely in the controller's hands.

alter table skills drop column default_session_minutes;

-- Note on the compatibility shims from 004 and 006: the v1 session flow no longer
-- WRITES through either of them — it updates `skills` directly and logs to `events`.
-- The views stay for now because the dashboard and the reminder cron still read
-- them; they are dropped in 008 once those last readers are ported.
