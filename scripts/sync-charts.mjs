// Runs on a GitHub Actions schedule (see .github/workflows/sync-charts.yml).
//
// Builds four independent feeds for SONIQ's Home screen and caches them in
// Firestore (charts/daily). Deezer is the master source; Jamendo is the
// fallback for the track feeds. Each feed succeeds or fails on its own -- a
// failed feed is simply left out of the write, so its last good copy stays
// in Firestore instead of being overwritten with nothing.
//
//   trending     global top tracks            (Deezer -> Jamendo)
//   topCharts    Deezer's "Top Nigeria" chart (Deezer -> Jamendo)
//   newReleases  newest albums found across the charts, by real release
//                date (Deezer -> Jamendo newest tracks)
//   playlists    Deezer chart playlists       (Deezer only)
//
// SONIQ never calls these APIs for the lists -- it only reads the cached doc.
// Deezer preview links are signed and expire after ~15 minutes, so the app
// asks Deezer for a fresh link at play time and only relies on the ids here.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DEEZER = 'https://api.deezer.com';
const JAMENDO = 'https://api.jamendo.com/v3.0';
const FEED_SIZE = 20;
const NEW_RELEASE_WINDOW_DAYS = 90;
const MIN_NEW_RELEASES = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  const label = url.split('?')[0];
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ' from ' + label);
  }
  const json = await res.json();
  if (json && json.error) {
    throw new Error('API error from ' + label + ': ' + JSON.stringify(json.error));
  }
  return json;
}

/* ---------- normalizers (the shape the app reads) ---------- */

function deezerTrack(t) {
  return {
    id: String(t.id),
    title: t.title || '',
    artist: (t.artist && t.artist.name) || '',
    art: (t.album && (t.album.cover_medium || t.album.cover)) || '',
    previewUrl: t.preview || '',
    duration: 30,
    provider: 'deezer',
  };
}

function usableDeezer(list) {
  return (list || []).filter((t) => t && t.id && t.title && t.preview);
}

function jamendoTrack(t) {
  return {
    id: String(t.id),
    title: t.name || '',
    artist: t.artist_name || '',
    art: t.image || '',
    previewUrl: t.audio || '',
    duration: Number(t.duration) || 0,
    provider: 'jamendo',
  };
}

/* ---------- Jamendo (fallback) ---------- */

async function jamendoTracks(params) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    throw new Error('JAMENDO_CLIENT_ID is not set');
  }
  const query = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: String(FEED_SIZE),
    ...params,
  });
  const json = await getJson(JAMENDO + '/tracks/?' + query.toString());
  const results = (json.results || []).filter((t) => t.audio);
  if (results.length === 0) {
    throw new Error('Jamendo returned no playable tracks for ' + JSON.stringify(params));
  }
  return results.map(jamendoTrack);
}

/* ---------- Deezer sources ---------- */

async function fetchNigeriaChart() {
  const search = await getJson(DEEZER + '/search/playlist?q=' + encodeURIComponent('Top Nigeria') + '&limit=10');
  const exact = (search.data || []).filter((p) => /^top nigeria$/i.test((p.title || '').trim()));
  const pick = exact.find((p) => p.user && /deezer/i.test(p.user.name || '')) || exact[0];
  if (!pick) {
    throw new Error('No "Top Nigeria" playlist found');
  }
  const tracks = await getJson(DEEZER + '/playlist/' + pick.id + '/tracks?limit=100');
  return usableDeezer(tracks.data);
}

async function deriveNewReleases(chartTracks) {
  // One representative track per album, then look up each album's real
  // release date and keep the genuinely recent ones, newest first.
  const byAlbum = new Map();
  for (const t of chartTracks) {
    if (t.album && t.album.id && !byAlbum.has(t.album.id)) {
      byAlbum.set(t.album.id, t);
    }
  }
  const dated = [];
  for (const albumId of Array.from(byAlbum.keys()).slice(0, 120)) {
    try {
      const album = await getJson(DEEZER + '/album/' + albumId);
      if (album.release_date) {
        dated.push({ date: album.release_date, track: byAlbum.get(albumId) });
      }
    } catch (err) {
      // one bad album lookup shouldn't sink the feed
    }
    await sleep(100); // stay well inside Deezer's rate limit
  }
  const cutoff = new Date(Date.now() - NEW_RELEASE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const recent = dated
    .filter((x) => x.date >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (recent.length < MIN_NEW_RELEASES) {
    throw new Error('Only ' + recent.length + ' recent albums found (need ' + MIN_NEW_RELEASES + ')');
  }
  return recent.slice(0, FEED_SIZE).map((x) => ({ ...deezerTrack(x.track), releaseDate: x.date }));
}

async function fetchPlaylists() {
  const json = await getJson(DEEZER + '/chart/0/playlists?limit=' + FEED_SIZE);
  const items = (json.data || [])
    .filter((p) => p && p.id && p.title)
    .map((p) => ({
      id: String(p.id),
      title: p.title,
      art: p.picture_medium || p.picture || '',
      trackCount: p.nb_tracks || 0,
      creator: (p.user && p.user.name) || '',
    }));
  if (items.length === 0) {
    throw new Error('Deezer returned no chart playlists');
  }
  return items;
}

/* ---------- feed assembly ---------- */

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(label + ' failed: ' + err.message);
    return null;
  }
}

async function buildFeeds() {
  const feeds = {};
  const stamp = () => new Date().toISOString();

  const globalRaw = await attempt('Deezer global chart', async () => {
    const json = await getJson(DEEZER + '/chart/0/tracks?limit=100');
    return usableDeezer(json.data);
  });
  const nigeriaRaw = await attempt('Deezer Top Nigeria', fetchNigeriaChart);

  // trending
  if (globalRaw && globalRaw.length >= FEED_SIZE) {
    feeds.trending = { source: 'deezer', fetchedAt: stamp(), tracks: globalRaw.slice(0, FEED_SIZE).map(deezerTrack) };
  } else {
    const tracks = await attempt('Jamendo trending', () => jamendoTracks({ order: 'popularity_total' }));
    if (tracks) feeds.trending = { source: 'jamendo', fetchedAt: stamp(), tracks };
  }

  // topCharts (Nigeria)
  if (nigeriaRaw && nigeriaRaw.length >= FEED_SIZE) {
    feeds.topCharts = { source: 'deezer', region: 'Nigeria', fetchedAt: stamp(), tracks: nigeriaRaw.slice(0, FEED_SIZE).map(deezerTrack) };
  } else {
    const tracks =
      (await attempt('Jamendo afrobeat charts', () => jamendoTracks({ tags: 'afrobeat', order: 'popularity_total' }))) ||
      (await attempt('Jamendo charts', () => jamendoTracks({ order: 'popularity_total', offset: String(FEED_SIZE) })));
    if (tracks) feeds.topCharts = { source: 'jamendo', region: 'Nigeria', fetchedAt: stamp(), tracks };
  }

  // newReleases
  const chartPool = [].concat(nigeriaRaw || [], globalRaw || []);
  let newTracks = null;
  let newSource = 'deezer';
  if (chartPool.length > 0) {
    newTracks = await attempt('Deezer new releases', () => deriveNewReleases(chartPool));
  }
  if (!newTracks) {
    newTracks = await attempt('Jamendo new releases', () => jamendoTracks({ order: 'releasedate_desc' }));
    newSource = 'jamendo';
  }
  if (newTracks) feeds.newReleases = { source: newSource, fetchedAt: stamp(), tracks: newTracks };

  // playlists (Deezer only -- Jamendo playlists have no artwork)
  const items = await attempt('Deezer playlists', fetchPlaylists);
  if (items) feeds.playlists = { source: 'deezer', fetchedAt: stamp(), items };

  return feeds;
}

async function main() {
  const feeds = await buildFeeds();
  const names = Object.keys(feeds);

  for (const name of names) {
    const f = feeds[name];
    console.log('Feed ' + name + ': ' + f.source + ' (' + (f.tracks || f.items).length + ' items)');
  }
  if (names.length === 0) {
    throw new Error('Every feed failed -- leaving the existing cache untouched');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  // Secrets sometimes carry literal "\n" sequences instead of real newlines.
  const privateKey = rawKey.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing one or more required Firebase secrets');
  }

  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  // This project's database has the literal ID 'default' (no parentheses).
  const db = getFirestore(app, 'default');

  await db.collection('charts').doc('daily').set(
    {
      ...feeds,
      updatedAt: new Date().toISOString(),
      // retire the old single-feed fields from the first version of this job
      tracks: FieldValue.delete(),
      source: FieldValue.delete(),
      fetchedAt: FieldValue.delete(),
    },
    { merge: true }
  );

  console.log('Cache updated: ' + names.join(', '));
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exitCode = 1;
});
