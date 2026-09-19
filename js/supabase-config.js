/*
 * supabase-config.js — connexion à la base de données en ligne.
 * Projet Supabase dédié à Finance Nerd (séparé d'Aurora/Osmosy/Ironly
 * pour isoler les données financières) — compte de connexion distinct.
 * L'URL et la clé publique ci-dessous sont publiques par design : la
 * sécurité vient des règles définies dans Supabase (chacun ne peut
 * lire/écrire que ses propres données), pas du secret de cette clé.
 */

const SUPABASE_URL = "https://znwqdmbippqkksurpqud.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bPx_799JW24BauqN84h1nQ_1Q0WgK2v";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
