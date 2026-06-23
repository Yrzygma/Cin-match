const TMDB_KEY = "c61d7d8e6e2a2a3a64aa7a0390814eb2";
const TMDB_BASE = "https://api.themoviedb.org/3";

const GENRE_MAP = {
  action: 28, comedy: 35, thriller: 53, scifi: 878,
  horror: 27, drama: 18, romance: 10749, animation: 16,
  adventure: 12, documentary: 99,
};

const PROVIDER_INFO = {
  8:   { name: "Netflix" },
  119: { name: "Amazon Prime" },
  337: { name: "Disney+" },
  350: { name: "Apple TV+" },
  190: { name: "Canal+" },
  56:  { name: "OCS" },
  531: { name: "Paramount+" },
  29:  { name: "Free" },
};

// Mood filter configurations
const MOOD_PARAMS = {
  feelgood:  { keywords: "10749",   runtime_lte: null, runtime_gte: null, release_gte: null, release_lte: null },
  thrills:   { keywords: null,      runtime_lte: null, runtime_gte: null, release_gte: null, release_lte: null },
  thinking:  { keywords: "10181",   runtime_lte: null, runtime_gte: null, release_gte: null, release_lte: null },
  emotional: { keywords: "9717",    runtime_lte: null, runtime_gte: null, release_gte: null, release_lte: null },
  short:     { keywords: null,      runtime_lte: 90,   runtime_gte: null, release_gte: null, release_lte: null },
  long:      { keywords: null,      runtime_lte: null, runtime_gte: 120,  release_gte: null, release_lte: null },
  recent:    { keywords: null,      runtime_lte: null, runtime_gte: null, release_gte: "2020-01-01", release_lte: null },
  classic:   { keywords: null,      runtime_lte: null, runtime_gte: null, release_gte: null, release_lte: "2005-12-31" },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { genre, page = 1, providers, moods } = req.query;
  if (!genre || !GENRE_MAP[genre]) return res.status(400).json({ error: "Invalid genre" });

  // Provider filter (flatrate only)
  const providerParam = providers
    ? `&with_watch_providers=${providers}&watch_region=FR&with_watch_monetization_types=flatrate`
    : "";

  // Mood filters - merge all selected moods
  let runtimeLte = null, runtimeGte = null, releaseDateGte = null, releaseDateLte = null;
  const moodList = moods ? moods.split(",") : [];
  for (const mood of moodList) {
    const cfg = MOOD_PARAMS[mood];
    if (!cfg) continue;
    if (cfg.runtime_lte !== null) runtimeLte = runtimeLte ? Math.min(runtimeLte, cfg.runtime_lte) : cfg.runtime_lte;
    if (cfg.runtime_gte !== null) runtimeGte = runtimeGte ? Math.max(runtimeGte, cfg.runtime_gte) : cfg.runtime_gte;
    if (cfg.release_gte) releaseDateGte = cfg.release_gte;
    if (cfg.release_lte) releaseDateLte = cfg.release_lte;
  }

  const moodParam = [
    runtimeLte ? `&with_runtime.lte=${runtimeLte}` : "",
    runtimeGte ? `&with_runtime.gte=${runtimeGte}` : "",
    releaseDateGte ? `&primary_release_date.gte=${releaseDateGte}` : "",
    releaseDateLte ? `&primary_release_date.lte=${releaseDateLte}` : "",
  ].join("");

  try {
    const pageNums = providers ? [1, 2, 3, 4, 5] : [1, 2, 3];
    const pages = await Promise.all(
      pageNums.map((p) =>
        fetch(`${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}&with_genres=${GENRE_MAP[genre]}&sort_by=popularity.desc&vote_count.gte=100&language=fr-FR${providerParam}${moodParam}&page=${Number(page) + p - 1}`)
          .then((r) => r.json())
      )
    );

    const rawMovies = pages
      .flatMap((p) => p.results || [])
      .filter((m) => m.poster_path)
      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
      .slice(0, 40);

    // Fetch providers + trailers in parallel
    const [providerResults, trailerResults] = await Promise.all([
      Promise.all(rawMovies.map((m) =>
        fetch(`${TMDB_BASE}/movie/${m.id}/watch/providers?api_key=${TMDB_KEY}`)
          .then((r) => r.json()).catch(() => null)
      )),
      Promise.all(rawMovies.map((m) =>
        fetch(`${TMDB_BASE}/movie/${m.id}/videos?api_key=${TMDB_KEY}&language=fr-FR`)
          .then((r) => r.json()).catch(() => null)
      )),
    ]);

    let movies = rawMovies.map((m, i) => {
      // Providers
      const frData = providerResults[i]?.results?.FR || {};
      const flatrate = (frData.flatrate || [])
        .filter((p) => PROVIDER_INFO[p.provider_id])
        .map((p) => ({
          id: p.provider_id,
          name: PROVIDER_INFO[p.provider_id].name,
          logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
        }));

      // Trailer — prefer French, fallback to English
      const videos = trailerResults[i]?.results || [];
      const trailer =
        videos.find(v => v.type === "Trailer" && v.site === "YouTube" && v.iso_639_1 === "fr") ||
        videos.find(v => v.type === "Trailer" && v.site === "YouTube") ||
        videos.find(v => v.site === "YouTube");

      return {
        id: m.id,
        title: m.title,
        year: m.release_date ? parseInt(m.release_date.split("-")[0]) : null,
        poster: `https://image.tmdb.org/t/p/w342${m.poster_path}`,
        imdb: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
        synopsis: m.overview || "",
        popularity: m.popularity,
        streamingOn: flatrate,
        trailerKey: trailer?.key || null,
      };
    });

    // Strict filter: only movies on selected platforms
    if (providers) {
      const selectedIds = providers.split(",").map(Number);
      movies = movies.filter((m) => m.streamingOn.some((p) => selectedIds.includes(p.id)));
    }

    movies.sort(() => Math.random() - 0.5);
    res.status(200).json({ movies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
