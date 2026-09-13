import type { Config } from "@netlify/functions";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Runs on a schedule (see config below). Tries Deezer's public chart
 * endpoint first; if that fails for any reason, falls back to Jamendo's
 * catalog. Whichever succeeds gets written into Firestore as one cached
 * document, alongside a fetchedAt timestamp.
 *
 * The SONIQ app itself never calls Deezer or Jamendo directly — it only
 * ever reads this cached Firestore doc, the same way it already reads
 * everything else via the client SDK. That keeps this function's own
 * call volume tiny and constant (one run per schedule tick) regardless
 * of how many people are using the app.
 *
 * If BOTH providers fail, this deliberately does nothing rather than
 * overwrite the cache with an error or empty data — a stale-but-good
 * cache is always better than a broken one. The client is responsible
 * for deciding what "too stale" means; this function's only job is to
 * never write bad data.
 */

type NormalizedTrack = {
  title: string;
  artist: string;
  art: string;
  previewUrl: string;
};

async function fetchFromDeezer(): Promise<NormalizedTrack[]> {
  const res = await fetch("https://api.deezer.com/chart/0/tracks?limit=20");
  if (!res.ok) {
    throw new Error("Deezer responded with status " + res.status);
  }
  const json: any = await res.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error("Deezer: unexpected response shape");
  }
  return json.data.map((t: any) => ({
    title: t.title || "",
    artist: (t.artist && t.artist.name) || "",
    art: (t.album && (t.album.cover_medium || t.album.cover)) || "",
    previewUrl: t.preview || "",
  }));
}

async function fetchFromJamendo(): Promise<NormalizedTrack[]> {
  const clientId = Netlify.env.get("JAMENDO_CLIENT_ID");
  if (!clientId) {
    throw new Error("Jamendo: JAMENDO_CLIENT_ID is not set");
  }
  const url =
    "https://api.jamendo.com/v3.0/tracks/?client_id=" +
    encodeURIComponent(clientId) +
    "&format=json&limit=20&order=popularity_total";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Jamendo responded with status " + res.status);
  }
  const json: any = await res.json();
  if (!json || !Array.isArray(json.results)) {
    throw new Error("Jamendo: unexpected response shape");
  }
  return json.results.map((t: any) => ({
    title: t.name || "",
    artist: t.artist_name || "",
    art: t.image || "",
    previewUrl: t.audio || "",
  }));
}

function getDb() {
  if (getApps().length === 0) {
    const projectId = Netlify.env.get("FIREBASE_PROJECT_ID");
    const clientEmail = Netlify.env.get("FIREBASE_CLIENT_EMAIL");
    const rawKey = Netlify.env.get("FIREBASE_PRIVATE_KEY") || "";
    // Env vars sometimes carry literal "\n" sequences instead of real
    // newlines depending on how they were pasted in — normalize either way.
    const privateKey = rawKey.replace(/\\n/g, "\n");
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }
  return getFirestore();
}

export default async (req: Request) => {
  let tracks: NormalizedTrack[] | null = null;
  let source = "deezer";

  try {
    tracks = await fetchFromDeezer();
  } catch (deezerErr) {
    console.error("Deezer fetch failed, trying Jamendo:", deezerErr);
    try {
      tracks = await fetchFromJamendo();
      source = "jamendo";
    } catch (jamendoErr) {
      console.error("Jamendo fetch also failed — leaving existing cache untouched:", jamendoErr);
      return;
    }
  }

  if (!tracks || tracks.length === 0) {
    console.error("Got an empty track list from " + source + " — leaving existing cache untouched");
    return;
  }

  const db = getDb();
  await db.collection("charts").doc("daily").set({
    tracks: tracks,
    source: source,
    fetchedAt: new Date().toISOString(),
  });

  console.log("Chart cache synced from " + source + " (" + tracks.length + " tracks)");
};

export const config: Config = {
  // Every 6 hours. Comfortably inside both providers' limits even at
  // real scale, since the app's users never trigger this directly.
  schedule: "0 */6 * * *",
};
