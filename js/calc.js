/*
 * calc.js — règles de calcul pures : montant mensualisé (lissage des
 * flux trimestriels/annuels), part de chacun sur les flux partagés.
 * Aucune donnée n'est lue/écrite ici, seulement des fonctions pures
 * sur des objets "flow" tels que renvoyés par Storage.getFlows().
 */

const Calc = (() => {
  const FLOW_TYPE_LABELS = {
    credit: "Crédit",
    debit_obligatoire: "Débit obligatoire",
    debit_facultatif: "Débit facultatif",
    epargne: "Épargne",
  };

  const FREQUENCY_LABELS = {
    mensuel: "Mensuel",
    trimestriel: "Trimestriel",
    annuel: "Annuel",
    ponctuel: "Ponctuel",
  };

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Montant ramené à une base mensuelle, pour comparer des flux de
  // fréquences différentes. Un flux ponctuel n'est pas récurrent : il
  // ne compte pas dans les totaux mensualisés.
  function monthlyAmount(flow) {
    switch (flow.frequency) {
      case "trimestriel":
        return round2(flow.amount / 3);
      case "annuel":
        return round2(flow.amount / 12);
      case "ponctuel":
        return 0;
      default:
        return flow.amount;
    }
  }

  function effectiveSharePercent(flow, defaultPercent) {
    if (flow.shareMode === "amount") {
      return flow.amount ? round2(((flow.shareAmountMine || 0) / flow.amount) * 100) : 0;
    }
    return flow.sharePercent === null || flow.sharePercent === undefined ? defaultPercent : flow.sharePercent;
  }

  // Part de l'utilisateur sur le montant réel du flux (pas mensualisé).
  function myAmount(flow, defaultPercent) {
    if (!flow.shared) return flow.amount;
    if (flow.shareMode === "amount") return round2(flow.shareAmountMine || 0);
    const pct = effectiveSharePercent(flow, defaultPercent);
    return round2((flow.amount * pct) / 100);
  }

  function jeromeAmount(flow, defaultPercent) {
    return round2(flow.amount - myAmount(flow, defaultPercent));
  }

  // Part de l'utilisateur sur le montant mensualisé.
  function myMonthlyAmount(flow, defaultPercent) {
    const monthly = monthlyAmount(flow);
    if (!flow.shared) return monthly;
    if (flow.shareMode === "amount") {
      if (!flow.amount) return 0;
      const factor = monthly / flow.amount;
      return round2((flow.shareAmountMine || 0) * factor);
    }
    const pct = effectiveSharePercent(flow, defaultPercent);
    return round2((monthly * pct) / 100);
  }

  function jeromeMonthlyAmount(flow, defaultPercent) {
    return round2(monthlyAmount(flow) - myMonthlyAmount(flow, defaultPercent));
  }

  function formatEUR(n) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  function formatPercent(n) {
    return `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  }

  return {
    FLOW_TYPE_LABELS,
    FREQUENCY_LABELS,
    round2,
    monthlyAmount,
    effectiveSharePercent,
    myAmount,
    jeromeAmount,
    myMonthlyAmount,
    jeromeMonthlyAmount,
    formatEUR,
    formatPercent,
  };
})();
