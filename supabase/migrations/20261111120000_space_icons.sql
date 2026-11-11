-- Optional emoji icon per space (shown in the sidebar instead of the colour dot).
alter table public.spaces add column icon text check (icon is null or char_length(icon) between 1 and 8);
