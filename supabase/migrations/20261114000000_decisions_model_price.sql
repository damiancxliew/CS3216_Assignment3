insert into model_price (
  model,
  input_usd_per_mtok,
  cached_input_usd_per_mtok,
  output_usd_per_mtok
) values (
  'gpt-6-luna-decisions',
  0.1,
  0.1,
  0
)
on conflict (model) do nothing;
