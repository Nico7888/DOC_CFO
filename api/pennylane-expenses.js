// api/pennylane-expenses.js
//
// Récupère toutes les factures fournisseurs (dépenses) Pennylane depuis le
// 1er janvier 2026, et les agrège par catégorie pour alimenter le panneau
// "Budgets" du dashboard (colonne "Réel").
//
// Comme pour pennylane-sync.js, le token reste côté serveur uniquement.

const PENNYLANE_BASE_URL = "https://app.pennylane.com/api/external/v2";
const FISCAL_YEAR_START = "2026-01-01";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.PENNYLANE_API_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "PENNYLANE_API_TOKEN manquant. Ajoute-le dans les variables d'environnement Vercel.",
    });
  }

  try {
    const invoices = await fetchAllSupplierInvoices(token);
    const { total, byCategory, uncategorizedCount } = aggregateByCategory(invoices);

    return res.status(200).json({
      synced_at: new Date().toISOString(),
      invoice_count: invoices.length,
      since: FISCAL_YEAR_START,
      total,
      uncategorized_count: uncategorizedCount,
      categories: byCategory,
    });
  } catch (err) {
    console.error("Pennylane expenses sync error:", err);
    return res.status(502).json({
      error: "Échec de la récupération des dépenses Pennylane",
      detail: err.message,
    });
  }
}

// Récupère toutes les factures fournisseurs depuis le début de l'exercice 2026
async function fetchAllSupplierInvoices(token) {
  const invoices = [];
  let cursor = null;
  let page = 0;
  const MAX_PAGES = 50;

  do {
    const url = new URL(`${PENNYLANE_BASE_URL}/supplier_invoices`);
    url.searchParams.set("per_page", "100");
    // Filtre côté API sur la date si le paramètre est supporté ; on refiltre
    // aussi côté serveur par sécurité (voir aggregateByCategory).
    url.searchParams.set(
      "filter",
      JSON.stringify([{ field: "date", operator: "gteq", value: FISCAL_YEAR_START }])
    );
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pennylane API ${response.status}: ${body}`);
    }

    const data = await response.json();
    const items = data.items || data.supplier_invoices || [];
    invoices.push(...items);

    cursor = data.next_cursor || (data.pagination && data.pagination.next_cursor) || null;
    page += 1;
  } while (cursor && page < MAX_PAGES);

  return invoices;
}

// Essaie plusieurs emplacements possibles pour retrouver le nom de catégorie
// d'une facture fournisseur, selon la façon dont elle a été taguée dans Pennylane.
function extractCategoryName(inv) {
  if (Array.isArray(inv.categories) && inv.categories.length > 0) {
    return inv.categories[0].label || inv.categories[0].name || null;
  }
  if (inv.category && (inv.category.label || inv.category.name)) {
    return inv.category.label || inv.category.name;
  }
  if (inv.ledger_account && (inv.ledger_account.label || inv.ledger_account.name)) {
    return inv.ledger_account.label || inv.ledger_account.name;
  }
  return null;
}

function aggregateByCategory(invoices) {
  const byCategory = {};
  let total = 0;
  let uncategorizedCount = 0;

  for (const inv of invoices) {
    if (inv.status && ["draft", "cancelled", "voided"].includes(inv.status)) continue;

    const dateStr = inv.date || inv.invoice_date || inv.created_at || "";
    if (dateStr && dateStr.slice(0, 10) < FISCAL_YEAR_START) continue; // sécurité double-filtre

    const amountHT = parseFloat(
      inv.currency_amount_before_tax ?? inv.amount_before_tax ?? 0
    );
    if (!amountHT) continue;

    let cat = extractCategoryName(inv);
    if (!cat) {
      cat = "Non catégorisé";
      uncategorizedCount++;
    }

    byCategory[cat] = (byCategory[cat] || 0) + amountHT;
    total += amountHT;
  }

  return {
    total,
    uncategorizedCount,
    byCategory: Object.entries(byCategory)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}
