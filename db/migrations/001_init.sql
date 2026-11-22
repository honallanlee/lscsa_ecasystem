-- Money is stored in whole cents. Registrations are never overwritten:
-- changing clubs adds a new version, and prices are copied at that moment.

create table staff (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  name text not null,
  role text not null check (role in ('helper', 'cashier', 'admin')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  staff_id uuid not null references staff on delete cascade,
  expires_at timestamptz not null
);
create index on sessions (staff_id);

create table login_failures (
  id bigint generated always as identity primary key,
  username text not null, ip text not null,
  at timestamptz not null default now()
);
create index on login_failures (at);

create table fairs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_current boolean not null default false,
  contact_name text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  email_domain text not null default '',
  created_at timestamptz not null default now()
);
create unique index one_current_fair on fairs (is_current) where is_current;

create table students (
  fair_id uuid not null references fairs,
  reg_no text not null,
  level text not null, name text not null, name_alt text not null default '',
  class text not null, class_no text not null, email text not null default '',
  primary key (fair_id, reg_no)
);

create table clubs (
  fair_id uuid not null references fairs,
  code text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name text not null,
  category text not null check (category in ('Academic', 'Cultural', 'Interest', 'Service', 'Sports')),
  fee_cents integer not null check (fee_cents >= 0),
  active boolean not null default true,
  primary key (fair_id, code)
);

create table rules (
  fair_id uuid not null references fairs,
  level text not null,
  academic int not null default 0 check (academic >= 0), cultural int not null default 0 check (cultural >= 0),
  interest int not null default 0 check (interest >= 0), service int not null default 0 check (service >= 0),
  sports int not null default 0 check (sports >= 0),
  min_clubs int not null check (min_clubs >= 0), max_clubs int not null check (max_clubs between 0 and 8),
  check (min_clubs <= max_clubs),
  check (academic + cultural + interest + service + sports <= max_clubs),
  primary key (fair_id, level)
);

create table registrations (
  id uuid primary key,                       -- made in the browser, so a retry cannot save twice
  fair_id uuid not null, reg_no text not null,
  version int not null check (version > 0),
  phone text not null check (phone ~ '^\d{8}$'),
  total_cents int not null check (total_cents >= 0),
  created_by uuid not null references staff,
  created_at timestamptz not null default now(),
  foreign key (fair_id, reg_no) references students,
  unique (fair_id, reg_no, version)
);

create table registration_clubs (
  registration_id uuid not null references registrations,
  code text not null, position int not null,
  name text not null, category text not null, fee_cents int not null check (fee_cents >= 0),
  primary key (registration_id, code)
);

create table checkouts (
  id uuid primary key,                       -- made in the browser, as above
  registration_id uuid not null unique references registrations,   -- one settlement per version, enforced here
  amount_cents int not null,                 -- negative is a refund
  method text not null check (method in ('None', 'Cash', 'FPS', 'Other')),
  tendered_cents int not null default 0, change_cents int not null default 0,
  created_by uuid not null references staff,
  created_at timestamptz not null default now(),
  check (change_cents >= 0),
  check (amount_cents <= 0 or tendered_cents - change_cents = amount_cents),
  check ((amount_cents = 0) = (method = 'None'))
);
create index on checkouts (created_at);

create table emails (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references checkouts,
  recipient text not null,
  status text not null default 'SENDING' check (status in ('SENDING', 'SENT', 'FAILED')),
  error text not null default '',
  requested_by uuid not null references staff,
  created_at timestamptz not null default now()
);
create index on emails (created_at);

create table notes (
  id uuid primary key,
  fair_id uuid not null, reg_no text not null,
  body text not null check (length(body) between 1 and 500),
  created_by uuid not null references staff,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (fair_id, reg_no) references students
);

create table cashups (
  id uuid primary key,
  fair_id uuid not null references fairs,
  day date not null, method text not null check (method in ('Cash', 'FPS', 'Other')),
  expected_cents int not null, counted_cents int not null check (counted_cents >= 0),
  remark text not null default '',
  created_by uuid not null references staff,
  created_at timestamptz not null default now()
);

create table audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_id uuid references staff,
  action text not null, detail text not null default ''
);

-- Where every student stands, in one place, so the cashier, dashboard and exports cannot disagree.
create view student_status as
select s.*, r.id as registration_id, coalesce(r.version, 0) as version, r.phone, r.created_at as registered_at,
  coalesce(r.total_cents, 0) as total_cents, p.paid_cents, p.confirmed_version, p.confirmed_registration_id,
  case when r.id is null then 0 else r.total_cents - p.paid_cents end as due_cents,
  case when r.id is null then 'NONE'
       when p.confirmed_version = r.version then 'CONFIRMED'
       when p.confirmed_version > 0 then 'AMENDED'
       else 'REGISTERED' end as status
from students s
left join lateral (
  select * from registrations x where x.fair_id = s.fair_id and x.reg_no = s.reg_no order by version desc limit 1
) r on true
left join lateral (
  select coalesce(sum(c.amount_cents), 0)::int as paid_cents, coalesce(max(x.version), 0) as confirmed_version,
    (array_agg(x.id order by x.version desc))[1] as confirmed_registration_id
  from checkouts c join registrations x on x.id = c.registration_id
  where x.fair_id = s.fair_id and x.reg_no = s.reg_no
) p on true;
