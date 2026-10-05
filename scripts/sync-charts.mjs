// Runs on a GitHub Actions schedule (see .github/workflows/sync-charts.yml).
// Tries Deezer's public chart endpoint first; if that fails for any reason,
// falls back to Jamendo's catalog. Whichever succeeds gets written into
// Firestore as one cached document, alongside a fetchedAt timestamp.
//
// SONIQ itself never calls Deezer or Jamendo directly -- it only ever reads
// this cached Firestore doc, the same way it already reads everything else
// via the client SDK. That keeps this job's own call volume tiny and
// constant (one run per schedule tick) regardless of how many people are
// using the app.
//
// If BOTH providers fail, this deliberately does nothing rather than
// overwrite the cache with an error or empty data -- a stale-but-good cache
// is always better than a broken one.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function fetchFromDeezer() {
  const res = await fetch('https://api.deezer.com/chart/0/tracks?limit=20');
  if (!res.ok) {
    throw new Error('Deezer responded with status ' + res.status);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Deezer: unexpected response shape');
  }
  return json.data.map((t) => ({
    title: t.title || '',
    artist: (t.artist && t.artist.name) || '',
    art: (t.album && (t.album.cover_medium || t.album.cover)) || '',
    previewUrl: t.preview || '',
  }));
}

async function fetchFromJamendo() {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    throw new Error('Jamendo: JAMENDO_CLIENT_ID is not set');
  }
  const url =
    'https://api.jamendo.com/v3.0/tracks/?client_id=' +
    encodeURIComponent(clientId) +
    '&format=json&limit=20&order=popularity_total';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Jamendo responded with status ' + res.status);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.results)) {
    throw new Error('Jamendo: unexpected response shape');
  }
  return json.results.map((t) => ({
    title: t.name || '',
    artist: t.artist_name || '',
    art: t.image || '',
    previewUrl: t.audio || '',
  }));
}

async function main() {
  let tracks = null;
  let source = 'deezer';

  try {
    tracks = await fetchFromDeezer();
  } catch (deezerErr) {
    console.error('Deezer fetch failed, trying Jamendo:', deezerErr.message);
    try {
      tracks = await fetchFromJamendo();
      source = 'jamendo';
    } catch (jamendoErr) {
      console.error('Jamendo fetch also failed -- leaving existing cache untouched:', jamendoErr.message);
      return;
    }
  }

  if (!tracks || tracks.length === 0) {
    console.error('Got an empty track list from ' + source + ' -- leaving existing cache untouched');
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  // GitHub Actions secrets sometimes carry literal "\n" sequences instead of
  // real newlines depending on how they were pasted in -- normalize either way.
  const privateKey = rawKey.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing one or more required Firebase secrets (check repo Settings -> Secrets and variables -> Actions)');
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  const db = getFirestore();
  await db.collection('charts').doc('daily').set({
    tracks,
    source,
    fetchedAt: new Date().toISOString(),
  });

  console.log('Chart cache synced from ' + source + ' (' + tracks.length + ' tracks)');
}

main().catch((err) => {
  console.error('Unexpected failure:', err);
  process.exitCode = 1;
});
