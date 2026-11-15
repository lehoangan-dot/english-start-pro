-- =====================================================================
-- ENGLISH START PRO – Tài khoản học viên (bản web công khai)
-- Chạy 1 lần trong Supabase → SQL Editor.
-- Học viên KHÔNG tự tạo tài khoản qua trình duyệt; tài khoản được tạo bởi
-- Edge Function "account" (dùng service role ở máy chủ) sau khi kiểm tra đủ thông tin.
-- =====================================================================

-- Hồ sơ học viên
create table if not exists public.students (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  full_name            text not null check (char_length(full_name) between 2 and 80),
  email                text not null unique,
  phone                text not null check (char_length(phone) between 9 and 15),
  address              text not null check (char_length(address) between 5 and 200),
  must_change_password boolean not null default true,
  consent_at           timestamptz not null default now(),   -- đồng ý xử lý dữ liệu cá nhân
  last_reset_at        timestamptz,
  last_seen_at         timestamptz,
  created_at           timestamptz not null default now()
);

-- Tiến độ học (toàn bộ trạng thái app dạng JSON + vài cột tóm tắt cho trang Quản trị)
create table if not exists public.progress (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  xp            integer not null default 0,
  lessons_done  smallint not null default 0,
  current_level smallint not null default 0,
  updated_at    timestamptz not null default now()
);

-- Quản trị viên
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Nhật ký đăng ký để chống spam (chỉ máy chủ đọc/ghi)
create table if not exists public.register_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists register_log_ip_time on public.register_log(ip_hash, created_at);

-- Hàm kiểm tra quyền quản trị
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Học viên báo đã đổi mật khẩu tạm
create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.students set must_change_password = false where user_id = auth.uid();
$$;

-- Ghi lần hoạt động gần nhất
create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update public.students set last_seen_at = now() where user_id = auth.uid();
$$;

-- ---------- PHÂN QUYỀN ----------
alter table public.students     enable row level security;
alter table public.progress     enable row level security;
alter table public.admins       enable row level security;
alter table public.register_log enable row level security;   -- không có policy: trình duyệt không truy cập được

drop policy if exists "students read own or admin" on public.students;
create policy "students read own or admin" on public.students
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "progress read own or admin" on public.progress;
create policy "progress read own or admin" on public.progress
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "progress insert own" on public.progress;
create policy "progress insert own" on public.progress
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "progress update own" on public.progress;
create policy "progress update own" on public.progress
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "admins read own" on public.admins;
create policy "admins read own" on public.admins
  for select to authenticated using (user_id = auth.uid());

revoke all on function public.mark_password_changed() from anon;
revoke all on function public.touch_last_seen() from anon;

-- ---------- CẤP QUYỀN QUẢN TRỊ (chạy SAU khi anh đã đăng ký tài khoản của mình trên app) ----------
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'EMAIL_CUA_ANH@gmail.com'
--   on conflict do nothing;
