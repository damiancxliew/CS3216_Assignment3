-- Existing adventures retain their authored atmosphere; new stages can select these effects.
alter type public.ambient_overlay add value if not exists 'thunderstorm';
alter type public.ambient_overlay add value if not exists 'haze';
