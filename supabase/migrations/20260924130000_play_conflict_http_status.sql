do $$
declare
  definition text;
  old_code constant text := 'errcode = ''40001''';
  new_code constant text := 'errcode = ''PT409''';
  occurrences integer;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.save_play_turn(uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,jsonb)'
  )) into definition;

  if definition is null then
    raise exception 'save_play_turn with minted options is missing';
  end if;

  occurrences := (length(definition) - length(replace(definition, old_code, ''))) / length(old_code);
  if occurrences <> 5 then
    raise exception 'expected five save_play_turn conflict codes, found %', occurrences;
  end if;

  execute replace(definition, old_code, new_code);
end;
$$;
