-- Finance Nerd — tables Supabase pour la synchronisation multi-appareils.
-- À exécuter une seule fois dans l'éditeur SQL du projet Supabase dédié
-- "Finance Nerd" (projet séparé d'Aurora/Osmosy/Ironly pour isoler les
-- données financières).

create extension if not exists pgcrypto;

-- Biens immobiliers (Ornano, Belleville, etc. — liste extensible)
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Supports d'épargne (Livret A, PEL, Assurance-vie, etc.)
create table if not exists savings_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  liquidity text not null default 'disponible' check (liquidity in ('disponible', 'bloquee')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Réglages personnels (répartition par défaut avec Jérôme, etc.)
create table if not exists settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_share_percent numeric(5,2) not null default 50,
  updated_at timestamptz not null default now()
);

-- Bibliothèque de flux récurrents (crédit/débit/épargne)
create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  amount numeric(10,2) not null,
  account_name text not null default '',
  flow_type text not null check (flow_type in ('credit', 'debit_obligatoire', 'debit_facultatif', 'epargne')),
  frequency text not null default 'mensuel' check (frequency in ('mensuel', 'trimestriel', 'annuel', 'ponctuel')),
  shared boolean not null default false,
  share_mode text not null default 'percentage' check (share_mode in ('percentage', 'amount')),
  share_percent numeric(5,2),
  share_amount_mine numeric(10,2),
  property_id uuid references properties(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Historique mensuel des soldes d'épargne
create table if not exists savings_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  savings_account_id uuid not null references savings_accounts(id) on delete cascade,
  month date not null,
  balance numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (savings_account_id, month)
);

alter table properties enable row level security;
alter table savings_accounts enable row level security;
alter table settings enable row level security;
alter table flows enable row level security;
alter table savings_balances enable row level security;

-- Chacun ne peut lire/écrire que ses propres données.
create policy "properties_select_own" on properties for select using (auth.uid() = user_id);
create policy "properties_insert_own" on properties for insert with check (auth.uid() = user_id);
create policy "properties_update_own" on properties for update using (auth.uid() = user_id);
create policy "properties_delete_own" on properties for delete using (auth.uid() = user_id);

create policy "savings_accounts_select_own" on savings_accounts for select using (auth.uid() = user_id);
create policy "savings_accounts_insert_own" on savings_accounts for insert with check (auth.uid() = user_id);
create policy "savings_accounts_update_own" on savings_accounts for update using (auth.uid() = user_id);
create policy "savings_accounts_delete_own" on savings_accounts for delete using (auth.uid() = user_id);

create policy "settings_select_own" on settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on settings for update using (auth.uid() = user_id);

create policy "flows_select_own" on flows for select using (auth.uid() = user_id);
create policy "flows_insert_own" on flows for insert with check (auth.uid() = user_id);
create policy "flows_update_own" on flows for update using (auth.uid() = user_id);
create policy "flows_delete_own" on flows for delete using (auth.uid() = user_id);

create policy "savings_balances_select_own" on savings_balances for select using (auth.uid() = user_id);
create policy "savings_balances_insert_own" on savings_balances for insert with check (auth.uid() = user_id);
create policy "savings_balances_update_own" on savings_balances for update using (auth.uid() = user_id);
create policy "savings_balances_delete_own" on savings_balances for delete using (auth.uid() = user_id);
