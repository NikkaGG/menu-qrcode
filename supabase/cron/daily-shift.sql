create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('menu-daily-shift','* * * * *','select public.rotate_daily_shift();');
select public.rotate_daily_shift();
