-- Allow the existing procedure-delete trigger to cancel follow-up rows without
-- broad table UPDATE privileges. RLS continues to scope changes to auth.uid().

grant update (status, cancelled_at, cancelled_by, cancel_reason)
  on table public.procedure_followup_tasks
  to authenticated;

grant update (status, cancelled_at, cancelled_by, cancel_reason)
  on table public.procedure_followup_plans
  to authenticated;
