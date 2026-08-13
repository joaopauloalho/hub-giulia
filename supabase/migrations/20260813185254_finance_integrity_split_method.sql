alter table public.procedures
  drop constraint if exists procedures_payment_method_check;

alter table public.procedures
  add constraint procedures_payment_method_check
  check (payment_method in ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'pix_parcelado', 'split'));
