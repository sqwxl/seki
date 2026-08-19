update users
set email = lower(email)
where email is not null and email <> lower(email);

create unique index if not exists idx_users_email_ci on users (lower(email));
