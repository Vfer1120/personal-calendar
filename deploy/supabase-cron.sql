-- Run once in the Supabase SQL editor after replacing the two placeholders.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'calendar-reminders',
  '* * * * *',
  $$select net.http_post(
    url := '<VERCEL_URL>/api/v1/internal/cron/reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );$$
);

select cron.schedule(
  'calendar-subscriptions',
  '*/5 * * * *',
  $$select net.http_post(
    url := '<VERCEL_URL>/api/v1/internal/cron/subscriptions',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );$$
);

select cron.schedule(
  'calendar-cleanup',
  '15 * * * *',
  $$select net.http_post(
    url := '<VERCEL_URL>/api/v1/internal/cron/cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );$$
);