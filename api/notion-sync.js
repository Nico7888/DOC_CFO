// api/notion-sync.js
//
// Fonction serverless (Vercel) qui va chercher les deals dans la base Notion
// "Gestion des clients" et renvoie deux listes : les prospects (statuts
// "À relancer" -> "À signer") et les clients à activer automatiquement
// (statut "BDD Livrée").
//
// Le token Notion N'EST JAMAIS exposé au navigateur : il reste côté serveur,
// lu depuis la variable d'environnement NOTION_API_TOKEN.

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE_URL = "https://api.notion.com/v1";

// Statuts "Statut Livraison" qui définissent la plage prospect (R2 à qualif -> à signer)
const PROSPECT_STATUSES = [
  "R2 à qualif",
  "À relancer",
  "Validation brief",
  "Retour brief",
  "Échantillon fait",
  "À signer",
];

// Statut qui déclenche le passage automatique en client actif
const CLIENT_STATUS = "BDD Livrée";

// Statuts exclus de la vue "Next steps" (deals morts / non pertinents / déjà clos)
const NEXT_STEP_EXCLUDED_STATUSES = ["Pas pertinent", "Deal terminé"];

// Le seul statut considéré comme "mature" avec un chiffrage précis.
// Tous les autres statuts de la plage prospect sont regroupés en "process de vente".
const MATURE_STATUS = "À signer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.NOTION_API_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token) {
    return res.status(500).json({
      error: "NOTION_API_TOKEN manquant. Ajoute-le dans les variables d'environnement Vercel.",
    });
  }
  if (!databaseId) {
    return res.status(500).json({
      error: "NOTION_DATABASE_ID manquant. Ajoute-le dans les variables d'environnement Vercel.",
    });
  }

  try {
    const pages = await fetchAllDeals(token, databaseId);
    const { prospects, newClients } = splitByStatus(pages);
    const nextSteps = extractNextSteps(pages);

    return res.status(200).json({
      synced_at: new Date().toISOString(),
      deal_count: pages.length,
      prospects,
      new_clients: newClients,
      next_steps: nextSteps,
    });
  } catch (err) {
    console.error("Notion sync error:", err);
    return res.status(502).json({
      error: "Échec de la synchronisation avec Notion",
      detail: err.message,
    });
  }
}

// Récupère toutes les pages (avec pagination) filtrées sur les statuts qui nous intéressent
async function fetchAllDeals(token, databaseId) {
  const pages = [];
  let cursor = undefined;
  let page = 0;
  const MAX_PAGES = 50; // garde-fou anti-boucle-infinie

  do {
    const response = await fetch(
      `${NOTION_BASE_URL}/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion API ${response.status}: ${body}`);
    }

    const data = await response.json();
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
    page += 1;
  } while (cursor && page < MAX_PAGES);

  return pages;
}

// Extrait les champs utiles d'une page Notion et lit sa proprité titre "Nom"
function extractDeal(page) {
  const props = page.properties || {};

  const nameProp = props["Nom"];
  const name =
    nameProp?.title?.map((t) => t.plain_text).join("") || "Deal sans nom";

  const status = props["Statut Livraison"]?.status?.name || null;
  const arr = props["ARR"]?.number ?? null;
  const firstPayment = props["1er paiement"]?.number ?? null;
  const nextStep = props["Next step"]?.rich_text?.map((t) => t.plain_text).join("") || "";

  // Chiffrage précis uniquement pour les deals matures ("À signer") :
  // priorité à l'ARR, sinon le montant du 1er paiement, sinon 0 (à chiffrer manuellement).
  const isMature = status === MATURE_STATUS;
  const chiffrage = isMature ? (arr ?? firstPayment ?? 0) : 0;

  return {
    name,
    status,
    stage: isMature ? "a_signer" : "process_vente",
    arr,
    first_payment: firstPayment,
    chiffrage,
    next_step: nextStep,
    notion_url: page.url,
    // Date de création réelle de la fiche dans Notion : sert à mesurer le
    // cycle de vente (entrée dans le pipe -> signature/BDD livrée).
    created_time: page.created_time || null,
  };
}

// Sépare les deals en deux listes : prospects (plage à relancer -> à signer)
// et nouveaux clients (statut "BDD Livrée")
function splitByStatus(pages) {
  const prospects = [];
  const newClients = [];

  pages.forEach((page) => {
    const deal = extractDeal(page);
    if (!deal.status) return;

    if (deal.status === CLIENT_STATUS) {
      newClients.push(deal);
    } else if (PROSPECT_STATUSES.includes(deal.status)) {
      prospects.push(deal);
    }
  });

  return { prospects, newClients };
}

// Construit la liste brute des "Next step" sur tout le pipeline (hors deals
// morts / non pertinents), pour la vue "Next steps" du dashboard : le
// classement par typologie et par temporalité se fait côté front.
function extractNextSteps(pages) {
  const nextSteps = [];

  pages.forEach((page) => {
    const deal = extractDeal(page);
    if (!deal.status) return;
    if (NEXT_STEP_EXCLUDED_STATUSES.includes(deal.status)) return;
    const text = (deal.next_step || "").trim();
    if (!text) return;

    nextSteps.push({
      name: deal.name,
      status: deal.status,
      next_step: text,
      notion_url: deal.notion_url,
    });
  });

  return nextSteps;
}
