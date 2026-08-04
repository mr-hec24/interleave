-- Interleave v1 — retire the compatibility shims
--
-- `sr_state` (004) and `sessions` (006) survived as views so the chain of branches
-- stayed runnable while their readers were ported one at a time: the session flow,
-- the dashboard, and the reminder cron each moved onto the v1 controller in turn.
-- With the cron ported, nothing reads either.
--
-- They come out rather than lingering harmlessly. Both silently discard the fields
-- they cannot represent — the `sessions` write path drops the model state that §10
-- requires on a review event, and `sr_state` accepts SM-2 columns and throws them
-- away. A second, lossier path to the same state is exactly the kind of thing that
-- gets used by accident later and produces events that look real and are not.

drop trigger if exists sessions_compat_insert on sessions;
drop function if exists sessions_compat_write();
drop view if exists sessions;

drop trigger if exists sr_state_compat_update on sr_state;
drop function if exists sr_state_compat_write();
drop view if exists sr_state;
