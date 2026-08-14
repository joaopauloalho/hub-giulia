-- Hub Giulia 3.3 — dashboard RPCs are authenticated-only.
revoke execute on function public.get_dashboard_attention_v1(date, integer) from anon;
revoke execute on function public.get_dashboard_overview_v1(date, date, date, date) from anon;
revoke execute on function public.get_dashboard_series_v1(date, date, text) from anon;

grant execute on function public.get_dashboard_attention_v1(date, integer) to authenticated;
grant execute on function public.get_dashboard_overview_v1(date, date, date, date) to authenticated;
grant execute on function public.get_dashboard_series_v1(date, date, text) to authenticated;
