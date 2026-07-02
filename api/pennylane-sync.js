// api/pennylane-sync.js
//
// Fonction serverless (Vercel) qui va chercher les factures clients dans
// Pennylane (API Entreprise v2) et renvoie des données agrégées, prêtes à
// être injectées dans le dashboard Strivia.
//
// Le token Pennylane N'EST JAMAIS exposé au navigateur : il reste côté
// serveur, lu depuis la variable d'environnement PENNYLANE_API_TOKEN.

const PENNYLANE_BASE_URL = "https://app.pennylane.com/api/external/v2";

export default async function handler(req, res) {
  // On n'autorise que GET (déclenché par le bouton "Synchroniser")
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
    const invoices = await fetchAllCustomerInvoices(token);
    const aggregated = aggregateByClientAndMonth(invoices);

    return res.status(200).json({
      synced_at: new Date().toISOString(),
      invoice_count: invoices.length,
      clients: aggregated,
    });
  } catch (err) {
    console.error("Pennylane sync error:", err);
    return res.status(502).json({
      error: "Échec de la synchronisation avec Pennylane",
      detail: err.message,
    });
  }
}

// Récupère toutes les factures clients (avec pagination)
async function fetchAllCustomerInvoices(token) {
  const invoices = [];
  let cursor = null;
  let page = 0;
  const MAX_PAGES = 50; // garde-fou anti-boucle-infinie

  do {
    const url = new URL(`${PENNYLANE_BASE_URL}/customer_invoices`);
    url.searchParams.set("per_page", "100");
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
    const items = data.items || data.customer_invoices || [];
    invoices.push(...items);

    cursor = data.next_cursor || (data.pagination && data.pagination.next_cursor) || null;
    page += 1;
  } while (cursor && page < MAX_PAGES);

  return invoices;
}

// Regroupe les factures par client puis par mois (AAAA-MM)
// Adapte cette fonction selon les champs exacts que ta sandbox Pennylane renvoie
// (vérifiable avec le bouton "Try It!" sur pennylane.readme.io).
function aggregateByClientAndMonth(invoices) {
  const byClient = {};

  for (const inv of invoices) {
    // Ignore les brouillons / factures annulées
    if (inv.status && ["draft", "cancelled", "voided"].includes(inv.status)) continue;

    const clientName =
      (inv.customer && (inv.customer.name || inv.customer_name)) || "Client inconnu";
    const dateStr = inv.date || inv.invoice_date || inv.created_at;
    const month = dateStr ? dateStr.slice(0, 7) : "inconnu"; // "2026-06"
    const amountHT = parseFloat(
      inv.currency_amount_before_tax ?? inv.amount_before_tax ?? 0
    );

    if (!byClient[clientName]) {
      byClient[clientName] = { name: clientName, monthly: {} };
    }
    if (!byClient[clientName].monthly[month]) {
      byClient[clientName].monthly[month] = 0;
    }
    byClient[clientName].monthly[month] += amountHT;
  }

  return Object.values(byClient);
}
