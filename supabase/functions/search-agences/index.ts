// Supabase Edge Function: search-agences
//
// Proxies a "real-estate agencies / mandataires in <city>" search to the
// Google Places API (New) so the Google API key never has to live in
// client-side JS. Requires a valid Supabase session (the project's default
// `verify_jwt = true` enforces this at the gateway, before this code even
// runs) so only users logged into the Burdigala CRM can trigger a search.
//
// --- Deploy (from a terminal, with the Supabase CLI installed) ---
//   1. cd into this project's root (the folder containing this "supabase" dir)
//   2. supabase login                                   (once)
//   3. supabase link --project-ref joaqpgxsjlidvaadeyyu  (once)
//   4. supabase secrets set GOOGLE_PLACES_API_KEY=xxxxxxxxxxxxxxxxxxxx --project-ref joaqpgxsjlidvaadeyyu
//   5. supabase functions deploy search-agences --project-ref joaqpgxsjlidvaadeyyu
//
// --- Google Cloud setup (console.cloud.google.com) ---
//   - Enable "Places API (New)" on the project tied to your API key.
//   - Create/restrict an API key to that API only (no HTTP referrer
//     restriction -- Edge Functions call it server-to-server).
//   - Set a daily quota cap (e.g. 500 requests) as a cost safety net.
//
// Request:  POST { "ville": "Bordeaux", "type": "agence" | "mandataire" }
//           (type defaults to "agence" if omitted, for backward compat)
// Response: { "results": [{ placeId, nom, tel, adresse, cp, ville, reseau? }] }
//           "reseau" (iad / Safti / Capifrance / Optimhome / BSK Immobilier)
//           is only present on "mandataire" results.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.addressComponents",
  "nextPageToken",
].join(",");

const MAX_PAGES = 3; // Google Places API (New) hard cap: 3 pages / 60 results per query.
const PAGE_TOKEN_DELAY_MS = 2000; // a fresh nextPageToken needs a short warm-up before it's valid.

// Grandes enseignes de mandataires immobiliers (agents indépendants, sans
// agence physique classique) : une recherche générique "agence immobilière"
// ne les fait pas remonter, on cible donc chaque réseau nommément.
const MANDATAIRE_NETWORKS = ["iad", "Safti", "Capifrance", "Optimhome", "BSK Immobilier"];

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
}

interface ResultItem {
  placeId: string;
  nom: string;
  tel: string;
  adresse: string;
  cp: string;
  ville: string;
  reseau?: string;
}

function extractComponent(place: PlaceResult, type: string): string {
  const comp = (place.addressComponents || []).find((c) => (c.types || []).includes(type));
  return (comp && (comp.longText || comp.shortText)) || "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(query: string, apiKey: string, pageToken?: string) {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "fr",
    regionCode: "FR",
    pageSize: 20,
  };
  if (pageToken) body.pageToken = pageToken;

  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Google Places API error ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json() as Promise<{ places?: PlaceResult[]; nextPageToken?: string }>;
}

function toResultItem(p: PlaceResult, fallbackVille: string, reseau?: string): ResultItem | null {
  const id = p.id;
  if (!id) return null;
  return {
    placeId: id,
    nom: (p.displayName && p.displayName.text) || "",
    tel: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    adresse: p.formattedAddress || "",
    cp: extractComponent(p, "postal_code"),
    ville: extractComponent(p, "locality") || fallbackVille,
    ...(reseau ? { reseau } : {}),
  };
}

// Recherche "agence immobilière <ville>" avec pagination complète (jusqu'à 60
// résultats), comme avant.
async function searchAgences(ville: string, apiKey: string): Promise<ResultItem[]> {
  const query = `agence immobilière ${ville}`;
  const seen = new Set<string>();
  const results: ResultItem[] = [];

  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAGE_TOKEN_DELAY_MS);
    const data = await fetchPage(query, apiKey, pageToken);
    for (const p of data.places || []) {
      const item = toResultItem(p, ville);
      if (!item || seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      results.push(item);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return results;
}

// Recherche "<réseau> <ville>" pour chaque grande enseigne de mandataires,
// en parallèle et sur une seule page chacune (un réseau donné compte
// rarement plus de 20 mandataires dans une même ville ; ça garde la requête
// rapide et limite le coût en appels Google Places).
async function searchMandataires(ville: string, apiKey: string): Promise<ResultItem[]> {
  const perNetwork = await Promise.all(
    MANDATAIRE_NETWORKS.map(async (reseau) => {
      try {
        const data = await fetchPage(`${reseau} ${ville}`, apiKey);
        return (data.places || [])
          .map((p) => toResultItem(p, ville, reseau))
          .filter((x): x is ResultItem => x !== null);
      } catch {
        return [] as ResultItem[];
      }
    })
  );
  const seen = new Set<string>();
  const results: ResultItem[] = [];
  for (const list of perNetwork) {
    for (const item of list) {
      if (seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      results.push(item);
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non supportée." }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Clé Google Places non configurée côté serveur." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let ville = "";
  let type = "agence";
  try {
    const body = await req.json();
    ville = String(body?.ville || "").trim();
    if (body?.type === "mandataire") type = "mandataire";
  } catch {
    // ignore, handled by the empty check below
  }
  if (!ville || ville.length > 100) {
    return new Response(JSON.stringify({ error: "Ville manquante ou invalide." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const results = type === "mandataire" ? await searchMandataires(ville, apiKey) : await searchAgences(ville, apiKey);
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Erreur inconnue." }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
