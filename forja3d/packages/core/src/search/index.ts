export interface SearchResult {
  title: string;
  url: string;
  source: string;
  thumbnail?: string;
  author?: string;
  likes?: number;
}

export interface SearchLink {
  source: string;
  url: string;
  note: string;
}

/** Enlaces de búsqueda directa en los repositorios de modelos más importantes. */
export function searchLinks(query: string): SearchLink[] {
  const q = encodeURIComponent(query.trim());
  return [
    { source: "Printables", url: `https://www.printables.com/search/models?q=${q}`, note: "Comunidad de Prusa, muchos modelos gratuitos y de calidad" },
    { source: "MakerWorld", url: `https://makerworld.com/en/search/models?keyword=${q}`, note: "Comunidad de Bambu Lab, perfiles listos para imprimir" },
    { source: "Thingiverse", url: `https://www.thingiverse.com/search?q=${q}&type=things`, note: "El repositorio más grande y antiguo" },
    { source: "Thangs", url: `https://thangs.com/search/${q}?scope=all`, note: "Buscador que indexa varios sitios, incluso por forma" },
    { source: "Cults3D", url: `https://cults3d.com/en/search?q=${q}`, note: "Modelos gratuitos y de pago, diseñadores profesionales" },
    { source: "MyMiniFactory", url: `https://www.myminifactory.com/search/?query=${q}`, note: "Modelos verificados, figuras y miniaturas" },
    { source: "GrabCAD", url: `https://grabcad.com/library?query=${q}`, note: "Piezas de ingeniería en CAD (STEP)" },
    { source: "Google Patents", url: `https://patents.google.com/?q=${q}`, note: "Para entender cómo funciona un invento y si está protegido" },
  ];
}

export async function searchThingiverse(query: string, token: string, fetchImpl: typeof fetch = fetch, limit = 10): Promise<SearchResult[]> {
  const url = `https://api.thingiverse.com/search/${encodeURIComponent(query)}?type=things&per_page=${limit}&sort=relevant`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Thingiverse respondió HTTP ${res.status}`);
  const body = (await res.json()) as { hits?: { name: string; public_url: string; thumbnail?: string; creator?: { name?: string }; like_count?: number }[] };
  return (body.hits ?? []).map((h) => ({
    title: h.name,
    url: h.public_url,
    source: "Thingiverse",
    thumbnail: h.thumbnail,
    author: h.creator?.name,
    likes: h.like_count,
  }));
}

export async function searchModels(
  query: string,
  opts: { thingiverseToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ results: SearchResult[]; links: SearchLink[]; errors: string[] }> {
  const errors: string[] = [];
  let results: SearchResult[] = [];
  if (opts.thingiverseToken) {
    try {
      results = await searchThingiverse(query, opts.thingiverseToken, opts.fetchImpl);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { results, links: searchLinks(query), errors };
}
