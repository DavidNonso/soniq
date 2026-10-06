// One-off diagnostic: asks Google which Firestore databases exist for the
// project this service account belongs to. Safe to delete afterwards.
import { initializeApp, cert } from 'firebase-admin/app';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const token = (await app.options.credential.getAccessToken()).access_token;

async function call(label, url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const text = await res.text();
  console.log('--- ' + label + ' -> HTTP ' + res.status);
  console.log(text.slice(0, 1500));
}

const pid = process.env.PROJECT_ID_PLAIN;
console.log('Using project id: ' + pid);
await call('list databases', 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases');
await call('get (default)', 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)');
