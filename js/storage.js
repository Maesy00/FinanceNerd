/*
 * storage.js — seul endroit qui lit/écrit les données dans Supabase.
 * Chaque liste reste disponible de façon synchrone via un cache local
 * rafraîchi après chaque appel réseau, pour ne pas avoir à réécrire
 * tout l'affichage de l'app en asynchrone.
 */

const Storage = (() => {
  let cache = {
    flows: [],
    properties: [],
    savingsAccounts: [],
    savingsBalances: [],
    settings: { defaultSharePercent: 50 },
  };

  function rowToFlow(row) {
    return {
      id: row.id,
      label: row.label,
      amount: Number(row.amount),
      accountName: row.account_name || "",
      flowType: row.flow_type,
      frequency: row.frequency,
      shared: row.shared,
      shareMode: row.share_mode,
      sharePercent: row.share_percent === null ? null : Number(row.share_percent),
      shareAmountMine: row.share_amount_mine === null ? null : Number(row.share_amount_mine),
      propertyId: row.property_id,
    };
  }

  function flowToRow(flow, userId) {
    return {
      user_id: userId,
      label: flow.label,
      amount: flow.amount,
      account_name: flow.accountName || "",
      flow_type: flow.flowType,
      frequency: flow.frequency,
      shared: !!flow.shared,
      share_mode: flow.shareMode || "percentage",
      share_percent: flow.shared && flow.shareMode === "percentage" ? flow.sharePercent : null,
      share_amount_mine: flow.shared && flow.shareMode === "amount" ? flow.shareAmountMine : null,
      property_id: flow.propertyId || null,
    };
  }

  function rowToProperty(row) {
    return { id: row.id, name: row.name };
  }

  function rowToSavingsAccount(row) {
    return { id: row.id, name: row.name, liquidity: row.liquidity || "disponible", sortOrder: row.sort_order || 0 };
  }

  function rowToSavingsBalance(row) {
    return {
      id: row.id,
      savingsAccountId: row.savings_account_id,
      month: row.month,
      balance: Number(row.balance),
    };
  }

  async function getUserId() {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    return user.id;
  }

  function getFlows() {
    return cache.flows;
  }

  function getProperties() {
    return cache.properties;
  }

  function getSavingsAccounts() {
    return cache.savingsAccounts;
  }

  function getSavingsBalances() {
    return cache.savingsBalances;
  }

  function getSettings() {
    return cache.settings;
  }

  async function refresh() {
    const [flowsRes, propsRes, savAccRes, savBalRes, settingsRes] = await Promise.all([
      supabaseClient.from("flows").select("*").order("created_at", { ascending: true }),
      supabaseClient.from("properties").select("*").order("name", { ascending: true }),
      supabaseClient.from("savings_accounts").select("*").order("sort_order", { ascending: true }),
      supabaseClient.from("savings_balances").select("*").order("month", { ascending: true }),
      supabaseClient.from("settings").select("*").maybeSingle(),
    ]);

    if (flowsRes.error) console.error("Erreur chargement flux :", flowsRes.error.message);
    if (propsRes.error) console.error("Erreur chargement biens :", propsRes.error.message);
    if (savAccRes.error) console.error("Erreur chargement supports d'épargne :", savAccRes.error.message);
    if (savBalRes.error) console.error("Erreur chargement soldes :", savBalRes.error.message);
    if (settingsRes.error) console.error("Erreur chargement réglages :", settingsRes.error.message);

    cache.flows = (flowsRes.data || []).map(rowToFlow);
    cache.properties = (propsRes.data || []).map(rowToProperty);
    cache.savingsAccounts = (savAccRes.data || []).map(rowToSavingsAccount);
    cache.savingsBalances = (savBalRes.data || []).map(rowToSavingsBalance);
    cache.settings = settingsRes.data
      ? { defaultSharePercent: Number(settingsRes.data.default_share_percent) }
      : { defaultSharePercent: 50 };
  }

  // ---- Flux ----

  async function addFlow(flow) {
    const userId = await getUserId();
    const { error } = await supabaseClient.from("flows").insert(flowToRow(flow, userId));
    if (error) return console.error("Erreur ajout flux :", error.message);
    await refresh();
  }

  async function updateFlow(id, flow) {
    const userId = await getUserId();
    const { error } = await supabaseClient.from("flows").update(flowToRow(flow, userId)).eq("id", id);
    if (error) return console.error("Erreur modification flux :", error.message);
    await refresh();
  }

  async function deleteFlow(id) {
    const { error } = await supabaseClient.from("flows").delete().eq("id", id);
    if (error) return console.error("Erreur suppression flux :", error.message);
    await refresh();
  }

  // ---- Biens immobiliers ----

  async function addProperty(name) {
    const userId = await getUserId();
    const { data, error } = await supabaseClient
      .from("properties")
      .insert({ user_id: userId, name })
      .select()
      .single();
    if (error) {
      console.error("Erreur ajout bien :", error.message);
      return null;
    }
    await refresh();
    return data.id;
  }

  async function renameProperty(id, name) {
    const { error } = await supabaseClient.from("properties").update({ name }).eq("id", id);
    if (error) return console.error("Erreur renommage bien :", error.message);
    await refresh();
  }

  async function deleteProperty(id) {
    const { error } = await supabaseClient.from("properties").delete().eq("id", id);
    if (error) return console.error("Erreur suppression bien :", error.message);
    await refresh();
  }

  // ---- Supports d'épargne ----

  async function addSavingsAccount(name, liquidity) {
    const userId = await getUserId();
    const maxOrder = cache.savingsAccounts.reduce((m, a) => Math.max(m, a.sortOrder || 0), 0);
    const { data, error } = await supabaseClient
      .from("savings_accounts")
      .insert({ user_id: userId, name, liquidity: liquidity || "disponible", sort_order: maxOrder + 1 })
      .select()
      .single();
    if (error) {
      console.error("Erreur ajout support d'épargne :", error.message);
      return null;
    }
    await refresh();
    return data.id;
  }

  async function renameSavingsAccount(id, name) {
    const { error } = await supabaseClient.from("savings_accounts").update({ name }).eq("id", id);
    if (error) return console.error("Erreur renommage support :", error.message);
    await refresh();
  }

  async function setSavingsAccountLiquidity(id, liquidity) {
    const { error } = await supabaseClient.from("savings_accounts").update({ liquidity }).eq("id", id);
    if (error) return console.error("Erreur modification du support :", error.message);
    await refresh();
  }

  async function setSavingsAccountOrder(id, sortOrder) {
    const { error } = await supabaseClient.from("savings_accounts").update({ sort_order: sortOrder }).eq("id", id);
    if (error) return console.error("Erreur réorganisation :", error.message);
  }

  async function swapSavingsAccountOrder(idA, orderA, idB, orderB) {
    await Promise.all([setSavingsAccountOrder(idA, orderB), setSavingsAccountOrder(idB, orderA)]);
    await refresh();
  }

  async function deleteSavingsAccount(id) {
    const { error } = await supabaseClient.from("savings_accounts").delete().eq("id", id);
    if (error) return console.error("Erreur suppression support :", error.message);
    await refresh();
  }

  // ---- Soldes d'épargne ----

  async function upsertSavingsBalance(savingsAccountId, month, balance) {
    const userId = await getUserId();
    const { error } = await supabaseClient
      .from("savings_balances")
      .upsert(
        { user_id: userId, savings_account_id: savingsAccountId, month, balance },
        { onConflict: "savings_account_id,month" }
      );
    if (error) return console.error("Erreur enregistrement solde :", error.message);
    await refresh();
  }

  async function deleteSavingsBalance(id) {
    const { error } = await supabaseClient.from("savings_balances").delete().eq("id", id);
    if (error) return console.error("Erreur suppression solde :", error.message);
    await refresh();
  }

  // ---- Réglages ----

  async function updateSettings(updates) {
    const userId = await getUserId();
    const { error } = await supabaseClient
      .from("settings")
      .upsert(
        { user_id: userId, default_share_percent: updates.defaultSharePercent },
        { onConflict: "user_id" }
      );
    if (error) return console.error("Erreur enregistrement réglages :", error.message);
    await refresh();
  }

  return {
    refresh,
    getFlows,
    getProperties,
    getSavingsAccounts,
    getSavingsBalances,
    getSettings,
    addFlow,
    updateFlow,
    deleteFlow,
    addProperty,
    renameProperty,
    deleteProperty,
    addSavingsAccount,
    renameSavingsAccount,
    setSavingsAccountLiquidity,
    swapSavingsAccountOrder,
    deleteSavingsAccount,
    upsertSavingsBalance,
    deleteSavingsBalance,
    updateSettings,
  };
})();
