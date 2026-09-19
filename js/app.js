/*
 * app.js — vues, formulaires et interactions. Toutes les données
 * viennent de Storage (source de vérité) ; ce fichier ne fait que
 * lire ce cache et déclencher des écritures via Storage.*
 */

const App = (() => {
  let currentView = "flows";
  let flowFilters = { type: "all", account: "all" };
  let currentPropertyTab = null;
  let savingsMonth = monthKeyForDate(new Date());

  // ---------------------------------------------------------------
  // Helpers génériques
  // ---------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function monthKeyForDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function addMonthsToKey(key, delta) {
    const [y, m] = key.split("-").map(Number);
    return monthKeyForDate(new Date(y, m - 1 + delta, 1));
  }

  function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }

  function shortMonthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  // ---------------------------------------------------------------
  // Modale générique (même pattern que les autres apps)
  // ---------------------------------------------------------------

  function openModal(contentHTML) {
    document.getElementById("modal-root").innerHTML = `<div class="modal-overlay"><div class="modal-card">${contentHTML}</div></div>`;
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      openModal(`
        <p class="confirm-message">${escapeHtml(message)}</p>
        <div class="session-actions">
          <button type="button" class="btn btn-ghost" data-action="confirm-no">Annuler</button>
          <button type="button" class="btn btn-primary" data-action="confirm-yes">Confirmer</button>
        </div>
      `);
      const root = document.getElementById("modal-root");
      root.onclick = (e) => {
        if (e.target.classList.contains("modal-overlay")) {
          closeModal();
          resolve(false);
          return;
        }
        if (e.target.closest('[data-action="confirm-yes"]')) {
          closeModal();
          resolve(true);
          return;
        }
        if (e.target.closest('[data-action="confirm-no"]')) {
          closeModal();
          resolve(false);
        }
      };
    });
  }

  // ---------------------------------------------------------------
  // Navigation entre vues
  // ---------------------------------------------------------------

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${view}`));
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  }

  // ---------------------------------------------------------------
  // Flux — carte + filtres + résumé (réutilisés par Flux et Biens)
  // ---------------------------------------------------------------

  function propertyName(propertyId) {
    const prop = Storage.getProperties().find((p) => p.id === propertyId);
    return prop ? prop.name : null;
  }

  function flowCardHTML(flow, settings) {
    const propName = propertyName(flow.propertyId);
    const freqBadge = flow.frequency !== "mensuel"
      ? `<span class="badge badge-freq">${Calc.FREQUENCY_LABELS[flow.frequency]}</span>`
      : "";
    const propBadge = propName ? `<span class="badge badge-property">${escapeHtml(propName)}</span>` : "";
    const shareBadge = flow.shared
      ? `<span class="badge badge-share">👥 ${flow.shareMode === "amount"
          ? `${Calc.formatEUR(Calc.myAmount(flow, settings.defaultSharePercent))} pour moi`
          : Calc.formatPercent(Calc.effectiveSharePercent(flow, settings.defaultSharePercent))}</span>`
      : "";
    const isCredit = flow.flowType === "credit";
    // Dès que le montant affiché en gros ne serait pas égal au montant
    // total du flux — flux partagé (on affiche ma part) et/ou fréquence
    // non-mensuelle (on affiche le montant mensualisé) — le total réel
    // est rappelé en petit à côté (le lissage n'a pas de sens pour un
    // flux ponctuel, seul le partage s'y applique alors).
    const isSmoothable = flow.frequency !== "mensuel" && flow.frequency !== "ponctuel";
    const showSplit = flow.shared || isSmoothable;
    const mainAmount = !showSplit
      ? flow.amount
      : flow.frequency === "ponctuel"
      ? Calc.myAmount(flow, settings.defaultSharePercent)
      : Calc.myMonthlyAmount(flow, settings.defaultSharePercent);
    const totalSubHTML = showSplit
      ? `<span class="flow-card-amount-sub">Total : ${Calc.formatEUR(flow.amount)}</span>`
      : "";
    return `
      <button type="button" class="card flow-card" data-flow-id="${flow.id}">
        <div class="flow-card-main">
          <span class="flow-card-label">${escapeHtml(flow.label)}</span>
          <span class="flow-card-amount-wrap">
            <span class="flow-card-amount ${isCredit ? "amount-positive" : "amount-negative"}">${isCredit ? "+" : "−"} ${Calc.formatEUR(mainAmount)}</span>
            ${totalSubHTML}
          </span>
        </div>
        <div class="flow-card-meta">
          <span class="badge badge-type-${flow.flowType}">${Calc.FLOW_TYPE_LABELS[flow.flowType]}</span>
          ${freqBadge}
          ${propBadge}
          ${shareBadge}
        </div>
        <div class="flow-card-account">${escapeHtml(flow.accountName || "—")}</div>
      </button>`;
  }

  function summaryBarHTML(flows, settings) {
    if (flows.length === 0) return "";
    const byType = {};
    flows.forEach((f) => {
      byType[f.flowType] = (byType[f.flowType] || 0) + Calc.myMonthlyAmount(f, settings.defaultSharePercent);
    });
    const pills = Object.entries(byType)
      .map(([t, v]) => `<span class="pill">${Calc.FLOW_TYPE_LABELS[t]} : ${Calc.formatEUR(v)}</span>`)
      .join("");
    return `<div class="summary-pills"><span class="pill pill-count">${flows.length} flux</span>${pills}</div>`;
  }

  // ---------------------------------------------------------------
  // Vue Flux
  // ---------------------------------------------------------------

  function renderFlowFilterOptions() {
    const accountSel = document.getElementById("filter-account");
    const current = flowFilters.account;
    accountSel.innerHTML = `<option value="all">Tous les comptes</option>` + ACCOUNTS.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    accountSel.value = [...accountSel.options].some((o) => o.value === current) ? current : "all";
    flowFilters.account = accountSel.value;
    document.getElementById("filter-type").value = flowFilters.type;
  }

  function applyFlowFilters(flows) {
    return flows.filter((f) => {
      if (flowFilters.type !== "all" && f.flowType !== flowFilters.type) return false;
      if (flowFilters.account !== "all" && f.accountName !== flowFilters.account) return false;
      return true;
    });
  }

  function renderFlowsView() {
    renderFlowFilterOptions();
    const settings = Storage.getSettings();
    const filtered = applyFlowFilters(Storage.getFlows());
    const list = document.getElementById("flows-list");
    const empty = document.getElementById("flows-empty");
    if (filtered.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      list.innerHTML = filtered.map((f) => flowCardHTML(f, settings)).join("");
    }
    document.getElementById("flows-summary").innerHTML = summaryBarHTML(filtered, settings);
  }

  // ---------------------------------------------------------------
  // Modale flux (création / édition)
  // ---------------------------------------------------------------

  function propertySelectOptionsHTML(selectedId) {
    return (
      `<option value="">Aucun</option>` +
      Storage.getProperties().map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")
    );
  }

  const ACCOUNTS = ["Boursorama Personnel", "Boursorama Dépenses", "Boursorama Joint", "Fortuneo"];

  function accountSelectOptionsHTML(selected) {
    return ACCOUNTS.map((a) => `<option value="${escapeHtml(a)}" ${a === selected ? "selected" : ""}>${escapeHtml(a)}</option>`).join("");
  }

  function flowModalHTML(flow) {
    const settings = Storage.getSettings();
    const isEdit = !!flow;
    const f = flow || {
      id: "",
      label: "",
      amount: "",
      accountName: "",
      flowType: "debit_obligatoire",
      frequency: "mensuel",
      shared: false,
      shareMode: "percentage",
      sharePercent: settings.defaultSharePercent,
      shareAmountMine: "",
      propertyId: "",
    };
    const isAmountMode = f.shareMode === "amount";
    return `
      <h3 class="modal-title">${isEdit ? "Modifier le flux" : "Nouveau flux"}</h3>
      <form id="flow-form">
        <label class="field"><span>Libellé</span>
          <input type="text" id="flow-label" required value="${escapeHtml(f.label)}" placeholder="Ex. Salaire, Crédit Immobilier Ornano…">
        </label>
        <label class="field"><span>Montant (€)</span>
          <input type="number" id="flow-amount" required step="0.01" min="0" inputmode="decimal" value="${f.amount}">
        </label>
        <label class="field"><span>Compte impacté</span>
          <select id="flow-account">${accountSelectOptionsHTML(f.accountName || ACCOUNTS[0])}</select>
        </label>
        <label class="field"><span>Type de flux</span>
          <select id="flow-type">
            <option value="credit" ${f.flowType === "credit" ? "selected" : ""}>Crédit</option>
            <option value="debit_obligatoire" ${f.flowType === "debit_obligatoire" ? "selected" : ""}>Débit — prélèvement obligatoire</option>
            <option value="debit_facultatif" ${f.flowType === "debit_facultatif" ? "selected" : ""}>Débit — prélèvement facultatif</option>
            <option value="epargne" ${f.flowType === "epargne" ? "selected" : ""}>Épargne</option>
          </select>
        </label>
        <label class="field"><span>Fréquence</span>
          <select id="flow-frequency">
            <option value="mensuel" ${f.frequency === "mensuel" ? "selected" : ""}>Mensuel</option>
            <option value="trimestriel" ${f.frequency === "trimestriel" ? "selected" : ""}>Trimestriel</option>
            <option value="annuel" ${f.frequency === "annuel" ? "selected" : ""}>Annuel</option>
            <option value="ponctuel" ${f.frequency === "ponctuel" ? "selected" : ""}>Ponctuel</option>
          </select>
        </label>
        <label class="field"><span>Bien immobilier</span>
          <select id="flow-property">${propertySelectOptionsHTML(f.propertyId)}</select>
        </label>

        <label class="field-checkbox">
          <input type="checkbox" id="flow-shared" ${f.shared ? "checked" : ""}>
          <span>Flux partagé avec Jérôme</span>
        </label>

        <div id="flow-share-detail" class="${f.shared ? "" : "hidden"}">
          <div class="radio-row">
            <label><input type="radio" name="share-mode" value="percentage" ${!isAmountMode ? "checked" : ""}> Pourcentage</label>
            <label><input type="radio" name="share-mode" value="amount" ${isAmountMode ? "checked" : ""}> Montant fixe</label>
          </div>
          <label class="field" id="share-percent-field" style="${isAmountMode ? "display:none" : ""}">
            <span>Ma part (%)</span>
            <input type="number" id="flow-share-percent" step="0.1" min="0" max="100" value="${f.sharePercent ?? settings.defaultSharePercent}">
          </label>
          <label class="field" id="share-amount-field" style="${isAmountMode ? "" : "display:none"}">
            <span>Montant qui me revient (€)</span>
            <input type="number" id="flow-share-amount" step="0.01" min="0" value="${f.shareAmountMine ?? ""}">
          </label>
        </div>

        <p id="flow-error" class="auth-error hidden"></p>

        <div class="session-actions">
          ${isEdit
            ? `<button type="button" class="btn btn-ghost" data-action="delete-flow" data-flow-id="${f.id}">Supprimer</button>`
            : `<button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>`}
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    `;
  }

  function openFlowModal(flow) {
    openModal(flowModalHTML(flow));
    const root = document.getElementById("modal-root");
    const sharedCb = root.querySelector("#flow-shared");
    const detail = root.querySelector("#flow-share-detail");

    sharedCb.addEventListener("change", () => detail.classList.toggle("hidden", !sharedCb.checked));
    root.querySelectorAll('input[name="share-mode"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        const isAmount = e.target.value === "amount";
        root.querySelector("#share-percent-field").style.display = isAmount ? "none" : "";
        root.querySelector("#share-amount-field").style.display = isAmount ? "" : "none";
      });
    });

    root.onclick = async (e) => {
      if (e.target.classList.contains("modal-overlay") || e.target.closest('[data-action="close-modal"]')) {
        closeModal();
        return;
      }
      const delBtn = e.target.closest('[data-action="delete-flow"]');
      if (delBtn) {
        const ok = await confirmDialog("Supprimer ce flux ?");
        if (ok) {
          await Storage.deleteFlow(delBtn.dataset.flowId);
          closeModal();
          renderAll();
          showToast("Flux supprimé");
        }
      }
    };

    root.querySelector("#flow-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = root.querySelector("#flow-error");
      errorEl.classList.add("hidden");

      const label = root.querySelector("#flow-label").value.trim();
      const amount = parseFloat(root.querySelector("#flow-amount").value);
      if (!label || isNaN(amount) || amount < 0) {
        errorEl.textContent = "Vérifie le libellé et le montant.";
        errorEl.classList.remove("hidden");
        return;
      }

      const shared = root.querySelector("#flow-shared").checked;
      const shareModeInput = root.querySelector('input[name="share-mode"]:checked');
      const shareMode = shareModeInput ? shareModeInput.value : "percentage";

      const payload = {
        label,
        amount: Calc.round2(amount),
        accountName: root.querySelector("#flow-account").value.trim(),
        flowType: root.querySelector("#flow-type").value,
        frequency: root.querySelector("#flow-frequency").value,
        propertyId: root.querySelector("#flow-property").value || null,
        shared,
        shareMode,
        sharePercent: shared && shareMode === "percentage" ? Calc.round2(parseFloat(root.querySelector("#flow-share-percent").value) || 0) : null,
        shareAmountMine: shared && shareMode === "amount" ? Calc.round2(parseFloat(root.querySelector("#flow-share-amount").value) || 0) : null,
      };

      if (flow) {
        await Storage.updateFlow(flow.id, payload);
      } else {
        await Storage.addFlow(payload);
      }
      closeModal();
      renderAll();
      showToast(flow ? "Flux mis à jour" : "Flux ajouté");
    });
  }

  // ---------------------------------------------------------------
  // Vue Biens immobiliers
  // ---------------------------------------------------------------

  function renderPropertiesView() {
    const props = Storage.getProperties();
    const tabsEl = document.getElementById("property-tabs");
    const summaryEl = document.getElementById("property-summary");
    const listEl = document.getElementById("property-flows-list");

    if (props.length === 0) {
      tabsEl.innerHTML = "";
      summaryEl.innerHTML = "";
      listEl.innerHTML = `<p class="empty-hint">Ajoute un bien (Ornano, Belleville…) pour classer tes flux par appartement.</p>`;
      return;
    }

    if (!currentPropertyTab || !props.some((p) => p.id === currentPropertyTab)) {
      currentPropertyTab = props[0].id;
    }

    tabsEl.innerHTML = props
      .map((p) => `<button type="button" class="segmented-btn ${p.id === currentPropertyTab ? "active" : ""}" data-property-id="${p.id}">${escapeHtml(p.name)}</button>`)
      .join("");

    const settings = Storage.getSettings();
    const flows = Storage.getFlows().filter((f) => f.propertyId === currentPropertyTab);
    summaryEl.innerHTML = summaryBarHTML(flows, settings);
    listEl.innerHTML = flows.length
      ? flows.map((f) => flowCardHTML(f, settings)).join("")
      : `<p class="empty-hint">Aucun flux rattaché à ce bien pour l'instant.</p>`;
  }

  // ---------------------------------------------------------------
  // Vue Commun (dépenses partagées avec Jérôme)
  // ---------------------------------------------------------------

  function renderCommunView() {
    const settings = Storage.getSettings();
    const shared = Storage.getFlows().filter((f) => f.shared);
    const recurring = shared.filter((f) => f.frequency !== "ponctuel");
    const oneTime = shared.filter((f) => f.frequency === "ponctuel");

    const depenseTypes = ["debit_obligatoire", "debit_facultatif"];
    const depenses = recurring.filter((f) => depenseTypes.includes(f.flowType));
    const totalDepenses = depenses.reduce((s, f) => s + Calc.monthlyAmount(f), 0);
    const myDepenses = depenses.reduce((s, f) => s + Calc.myMonthlyAmount(f, settings.defaultSharePercent), 0);
    const jeromeDepenses = depenses.reduce((s, f) => s + Calc.jeromeMonthlyAmount(f, settings.defaultSharePercent), 0);

    const listHTML = depenses.length
      ? `<div class="card-list">${depenses.map((f) => flowCardHTML(f, settings)).join("")}</div>`
      : `<p class="empty-hint">Aucune dépense commune pour l'instant.</p>`;

    const otherShared = recurring.filter((f) => !depenseTypes.includes(f.flowType));
    const otherHTML = otherShared.length
      ? `
      <div class="card">
        <h2 class="section-title">Autres flux partagés (crédit / épargne)</h2>
        <div class="card-list">${otherShared.map((f) => flowCardHTML(f, settings)).join("")}</div>
      </div>`
      : "";

    const oneTimeHTML = oneTime.length
      ? `
      <div class="card">
        <h2 class="section-title">Flux ponctuels partagés</h2>
        <div class="card-list">${oneTime.map((f) => flowCardHTML(f, settings)).join("")}</div>
      </div>`
      : "";

    document.getElementById("commun-content").innerHTML = `
      <div class="card treasury-hero neutral">
        <span class="treasury-hero-label">Dépenses communes mensuelles</span>
        <span class="treasury-hero-amount">${Calc.formatEUR(totalDepenses)}</span>
        <div class="split-stats">
          <div class="split-stat">
            <span class="split-stat-label">Ma part</span>
            <span class="split-stat-amount">${Calc.formatEUR(myDepenses)}</span>
          </div>
          <div class="split-stat">
            <span class="split-stat-label">Part de Jérôme</span>
            <span class="split-stat-amount">${Calc.formatEUR(jeromeDepenses)}</span>
          </div>
        </div>
      </div>
      ${listHTML}
      ${otherHTML}
      ${oneTimeHTML}
    `;
  }

  // ---------------------------------------------------------------
  // Vue Trésorerie mensuelle
  // ---------------------------------------------------------------

  function renderTreasuryView() {
    const settings = Storage.getSettings();
    const flows = Storage.getFlows();
    const recurring = flows.filter((f) => f.frequency !== "ponctuel");
    const oneTime = flows.filter((f) => f.frequency === "ponctuel");

    const types = ["credit", "debit_obligatoire", "debit_facultatif", "epargne"];
    const totals = {};
    types.forEach((t) => {
      const forType = recurring.filter((f) => f.flowType === t);
      totals[t] = forType.reduce((s, f) => s + Calc.myMonthlyAmount(f, settings.defaultSharePercent), 0);
    });

    const resteMine = totals.credit - totals.debit_obligatoire - totals.debit_facultatif - totals.epargne;

    const rows = types
      .map(
        (t) => `
      <div class="treasury-row">
        <span class="treasury-row-label">${Calc.FLOW_TYPE_LABELS[t]}</span>
        <span class="treasury-row-values">
          <strong>${Calc.formatEUR(totals[t])}</strong>
        </span>
      </div>`
      )
      .join("");

    const oneTimeHTML = oneTime.length
      ? `
      <div class="card">
        <h2 class="section-title">Flux ponctuels (hors calcul mensuel)</h2>
        <div class="card-list">${oneTime.map((f) => flowCardHTML(f, settings)).join("")}</div>
      </div>`
      : "";

    document.getElementById("treasury-content").innerHTML = `
      <div class="card treasury-hero ${resteMine >= 0 ? "positive" : "negative"}">
        <span class="treasury-hero-label">Reste à vivre mensuel</span>
        <span class="treasury-hero-amount">${Calc.formatEUR(resteMine)}</span>
      </div>
      <div class="card">
        ${rows}
      </div>
      ${oneTimeHTML}
    `;
  }

  // ---------------------------------------------------------------
  // Vue Épargne
  // ---------------------------------------------------------------

  function balanceFor(accountId, monthKey) {
    return Storage.getSavingsBalances().find((b) => b.savingsAccountId === accountId && b.month === monthKey);
  }

  function previousBalanceFor(accountId, monthKey) {
    return Storage.getSavingsBalances()
      .filter((b) => b.savingsAccountId === accountId && b.month < monthKey)
      .sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  }

  function savingsLineChartSVG(points) {
    if (points.length < 2) {
      return `<p class="empty-hint">Ajoute des soldes sur au moins deux mois pour voir l'évolution.</p>`;
    }
    const width = 320, height = 140, padding = 28;
    const values = points.map((p) => p.total);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = (width - padding * 2) / (points.length - 1);
    const coords = points.map((p, i) => ({
      x: padding + i * stepX,
      y: height - padding - ((p.total - min) / range) * (height - padding * 2),
      ...p,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const dots = coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" class="chart-dot"/>`).join("");
    const first = coords[0];
    const last = coords[coords.length - 1];
    return `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="none">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis"/>
        <path d="${path}" class="chart-line" fill="none"/>
        ${dots}
      </svg>
      <div class="chart-caption">
        <span>${shortMonthLabel(first.month)}</span>
        <strong>${Calc.formatEUR(last.total)}</strong>
        <span>${shortMonthLabel(last.month)}</span>
      </div>
    `;
  }

  const LIQUIDITY_LABELS = { disponible: "Disponible", bloquee: "Bloquée" };

  function savingsAccountCardHTML(acc) {
    const bal = balanceFor(acc.id, savingsMonth);
    const prev = previousBalanceFor(acc.id, savingsMonth);
    const delta = bal && prev ? Calc.round2(bal.balance - prev.balance) : null;
    const deltaHTML =
      delta === null
        ? ""
        : `<span class="delta ${delta >= 0 ? "delta-up" : "delta-down"}">${delta >= 0 ? "▲" : "▼"} ${Calc.formatEUR(Math.abs(delta))}</span>`;
    return `
      <div class="card savings-row">
        <div class="savings-row-head">
          <span class="savings-row-name">${escapeHtml(acc.name)}</span>
          ${deltaHTML}
        </div>
        <label class="field savings-balance-field">
          <span>Solde — ${capitalize(monthLabel(savingsMonth))}</span>
          <input type="number" step="0.01" class="savings-balance-input" data-account-id="${acc.id}" value="${bal ? bal.balance : ""}" placeholder="0,00">
        </label>
      </div>`;
  }

  function savingsGroupHTML(title, accounts) {
    if (accounts.length === 0) return "";
    return `
      <div class="savings-group">
        <h2 class="section-title">${title}</h2>
        <div class="savings-group-grid">${accounts.map((acc) => savingsAccountCardHTML(acc)).join("")}</div>
      </div>`;
  }

  function renderSavingsView() {
    document.getElementById("savings-month-label").textContent = capitalize(monthLabel(savingsMonth));
    const byName = (a, b) => a.name.localeCompare(b.name);
    const allAccounts = Storage.getSavingsAccounts();
    const disponibleAccounts = allAccounts.filter((a) => a.liquidity === "disponible").sort(byName);
    const bloqueeAccounts = allAccounts.filter((a) => a.liquidity === "bloquee").sort(byName);
    const accounts = [...disponibleAccounts, ...bloqueeAccounts];
    const listEl = document.getElementById("savings-accounts-list");

    if (accounts.length === 0) {
      listEl.innerHTML = `<p class="empty-hint">Ajoute un support d'épargne (Livret A, PEL, Assurance-vie…) pour commencer.</p>`;
    } else {
      listEl.innerHTML =
        savingsGroupHTML(LIQUIDITY_LABELS.disponible, disponibleAccounts) + savingsGroupHTML(LIQUIDITY_LABELS.bloquee, bloqueeAccounts);
    }

    const totalFor = (list, monthKey) =>
      list.reduce((s, acc) => {
        const b = balanceFor(acc.id, monthKey);
        return s + (b ? b.balance : 0);
      }, 0);

    const totalNow = totalFor(accounts, savingsMonth);
    const disponibleNow = totalFor(accounts.filter((a) => a.liquidity === "disponible"), savingsMonth);
    const bloqueeNow = totalFor(accounts.filter((a) => a.liquidity === "bloquee"), savingsMonth);
    const prevMonthKey = addMonthsToKey(savingsMonth, -1);
    const hasPrev = accounts.some((acc) => balanceFor(acc.id, prevMonthKey));
    const totalPrev = totalFor(accounts, prevMonthKey);
    const totalDelta = hasPrev ? Calc.round2(totalNow - totalPrev) : null;

    document.getElementById("savings-total-card").innerHTML = `
      <span class="savings-total-label">Total épargne</span>
      <span class="savings-total-amount">${Calc.formatEUR(totalNow)}</span>
      ${totalDelta === null
        ? `<span class="savings-total-sub">Pas de solde le mois précédent pour comparer</span>`
        : `<span class="delta ${totalDelta >= 0 ? "delta-up" : "delta-down"}">Mensuel ${totalDelta >= 0 ? "▲" : "▼"} ${Calc.formatEUR(Math.abs(totalDelta))}</span>`}
      <div class="split-stats">
        <div class="split-stat">
          <span class="split-stat-label">Disponible</span>
          <span class="split-stat-amount">${Calc.formatEUR(disponibleNow)}</span>
        </div>
        <div class="split-stat">
          <span class="split-stat-label">Bloquée</span>
          <span class="split-stat-amount">${Calc.formatEUR(bloqueeNow)}</span>
        </div>
      </div>
    `;

    const months = [...new Set(Storage.getSavingsBalances().map((b) => b.month))].sort();
    const chartPoints = months.map((m) => ({
      month: m,
      total: accounts.reduce((s, acc) => {
        const b = balanceFor(acc.id, m);
        return s + (b ? b.balance : 0);
      }, 0),
    }));
    document.getElementById("savings-chart").innerHTML = savingsLineChartSVG(chartPoints);
  }

  // ---------------------------------------------------------------
  // Gestion des listes de référence (biens / supports d'épargne)
  // ---------------------------------------------------------------

  function liquiditySelectOptionsHTML(selected) {
    return `
      <option value="disponible" ${selected === "disponible" ? "selected" : ""}>Disponible</option>
      <option value="bloquee" ${selected === "bloquee" ? "selected" : ""}>Bloquée</option>
    `;
  }

  function manageListModalHTML(config, items) {
    const withLiquidity = !!config.withLiquidity;
    return `
      <h3 class="modal-title">${config.title}</h3>
      <div class="manage-list">
        ${items
          .map(
            (it) => `
          <div class="manage-row" data-id="${it.id}">
            <input type="text" class="manage-row-input" value="${escapeHtml(it.name)}">
            ${withLiquidity ? `<select class="manage-row-liquidity">${liquiditySelectOptionsHTML(it.liquidity)}</select>` : ""}
            <button type="button" class="icon-btn" data-action="delete-item" aria-label="Supprimer">🗑</button>
          </div>`
          )
          .join("") || `<p class="empty-hint">Rien pour l'instant.</p>`}
      </div>
      <form id="manage-add-form" class="manage-add-form">
        <input type="text" id="manage-add-input" placeholder="${config.addPlaceholder}">
        ${withLiquidity ? `<select id="manage-add-liquidity">${liquiditySelectOptionsHTML("disponible")}</select>` : ""}
        <button type="submit" class="btn btn-secondary">Ajouter</button>
      </form>
      <button type="button" class="btn btn-ghost btn-block" data-action="close-modal">Fermer</button>
    `;
  }

  function openManageModal(config) {
    function render() {
      openModal(manageListModalHTML(config, config.getItems()));
      wire();
    }
    function wire() {
      const root = document.getElementById("modal-root");
      root.onclick = async (e) => {
        if (e.target.classList.contains("modal-overlay") || e.target.closest('[data-action="close-modal"]')) {
          closeModal();
          config.afterChange();
          return;
        }
        const delBtn = e.target.closest('[data-action="delete-item"]');
        if (delBtn) {
          const row = delBtn.closest(".manage-row");
          const ok = await confirmDialog("Supprimer cet élément ? Les flux déjà associés resteront mais ne seront plus rattachés.");
          if (ok) {
            await config.onDelete(row.dataset.id);
            render();
            config.afterChange();
          }
        }
      };
      root.querySelectorAll(".manage-row-input").forEach((input) => {
        input.addEventListener("change", async () => {
          const row = input.closest(".manage-row");
          const name = input.value.trim();
          if (name) {
            await config.onRename(row.dataset.id, name);
            config.afterChange();
          }
        });
      });
      root.querySelectorAll(".manage-row-liquidity").forEach((select) => {
        select.addEventListener("change", async () => {
          const row = select.closest(".manage-row");
          await config.onLiquidityChange(row.dataset.id, select.value);
          config.afterChange();
        });
      });
      root.querySelector("#manage-add-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = root.querySelector("#manage-add-input");
        const name = input.value.trim();
        if (!name) return;
        const liquiditySel = root.querySelector("#manage-add-liquidity");
        await config.onAdd(name, liquiditySel ? liquiditySel.value : undefined);
        render();
        config.afterChange();
      });
    }
    render();
  }

  function openManagePropertiesModal() {
    openManageModal({
      title: "Gérer les biens immobiliers",
      getItems: () => Storage.getProperties(),
      addPlaceholder: "Ex. Belleville",
      onAdd: (name) => Storage.addProperty(name),
      onRename: (id, name) => Storage.renameProperty(id, name),
      onDelete: (id) => Storage.deleteProperty(id),
      afterChange: () => {
        renderPropertiesView();
        renderFlowsView();
      },
    });
  }

  function openManageSavingsAccountsModal() {
    openManageModal({
      title: "Gérer les supports d'épargne",
      getItems: () => Storage.getSavingsAccounts(),
      addPlaceholder: "Ex. Livret A",
      withLiquidity: true,
      onAdd: (name, liquidity) => Storage.addSavingsAccount(name, liquidity),
      onRename: (id, name) => Storage.renameSavingsAccount(id, name),
      onLiquidityChange: (id, liquidity) => Storage.setSavingsAccountLiquidity(id, liquidity),
      onDelete: (id) => Storage.deleteSavingsAccount(id),
      afterChange: () => renderSavingsView(),
    });
  }

  // ---------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------

  function openSettingsModal() {
    const settings = Storage.getSettings();
    openModal(`
      <h3 class="modal-title">Réglages</h3>
      <form id="settings-form">
        <label class="field">
          <span>Répartition par défaut avec Jérôme — ma part (%)</span>
          <input type="number" id="settings-default-percent" step="0.1" min="0" max="100" value="${settings.defaultSharePercent}">
        </label>
        <p class="field-hint">S'applique par défaut aux nouveaux flux partagés ; ajustable flux par flux.</p>
        <div class="session-actions">
          <button type="button" class="btn btn-ghost" data-action="close-modal">Fermer</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    `);
    const root = document.getElementById("modal-root");
    root.onclick = (e) => {
      if (e.target.classList.contains("modal-overlay") || e.target.closest('[data-action="close-modal"]')) closeModal();
    };
    root.querySelector("#settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = Calc.round2(parseFloat(root.querySelector("#settings-default-percent").value) || 50);
      await Storage.updateSettings({ defaultSharePercent: val });
      closeModal();
      renderAll();
      showToast("Réglages enregistrés");
    });
  }

  // ---------------------------------------------------------------
  // Câblage des événements statiques (une seule fois au chargement)
  // ---------------------------------------------------------------

  document.addEventListener("click", (e) => {
    const card = e.target.closest(".flow-card");
    if (!card) return;
    const flow = Storage.getFlows().find((f) => f.id === card.dataset.flowId);
    if (flow) openFlowModal(flow);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.getElementById("filter-type").addEventListener("change", (e) => {
    flowFilters.type = e.target.value;
    renderFlowsView();
  });
  document.getElementById("filter-account").addEventListener("change", (e) => {
    flowFilters.account = e.target.value;
    renderFlowsView();
  });
  document.getElementById("btn-new-flow").addEventListener("click", () => openFlowModal(null));
  document.getElementById("btn-manage-properties").addEventListener("click", openManagePropertiesModal);
  document.getElementById("btn-manage-savings").addEventListener("click", openManageSavingsAccountsModal);
  document.getElementById("btn-settings").addEventListener("click", openSettingsModal);

  document.getElementById("property-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    currentPropertyTab = btn.dataset.propertyId;
    renderPropertiesView();
  });

  document.getElementById("savings-month-prev").addEventListener("click", () => {
    savingsMonth = addMonthsToKey(savingsMonth, -1);
    renderSavingsView();
  });
  document.getElementById("savings-month-next").addEventListener("click", () => {
    savingsMonth = addMonthsToKey(savingsMonth, 1);
    renderSavingsView();
  });
  document.getElementById("savings-accounts-list").addEventListener("change", async (e) => {
    if (!e.target.classList.contains("savings-balance-input")) return;
    const raw = e.target.value;
    if (raw === "") return;
    const value = parseFloat(raw);
    if (isNaN(value)) return;
    await Storage.upsertSavingsBalance(e.target.dataset.accountId, savingsMonth, Calc.round2(value));
    renderSavingsView();
    showToast("Solde enregistré");
  });

  function renderAll() {
    renderFlowsView();
    renderPropertiesView();
    renderCommunView();
    renderTreasuryView();
    renderSavingsView();
  }

  return { renderAll };
})();
