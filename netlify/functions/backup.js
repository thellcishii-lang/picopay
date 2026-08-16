// Daily backup, run by Netlify's scheduler. Two jobs:
//   1. Back up everything new since yesterday (small, regardless of how old
//      the store is).
//   2. Move transactions older than ARCHIVE_AFTER_DAYS out of the live
//      database into a permanent archive file, so the live app — and every
//      read of it — doesn't keep carrying years of history it rarely needs.
//
// A first version of this file read the entire transactions tree every
// night just to find what was new, which is exactly the "cost grows with
// total history" mistake this whole system was reworked to avoid elsewhere.
// Fixed here by querying each customer's transactions ordered by `ts` and
// asking only for what's past the watermark — the read scales with what's
// new, not with what's accumulated. This requires transactions/$customerId
// to have ts indexed (see firebase-rules.json: ".indexOn": ["ts"]).
//
// Written to Google Cloud Storage — same billing account as Firebase,
// no second project to set up, and lifecycle can be managed per prefix.
const admin = require("firebase-admin");
const { Storage } = require("@google-cloud/storage");
const zlib = require("zlib");

const DATABASE_URL =
  "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app";
const BUCKET_NAME = process.env.BACKUP_BUCKET_NAME;
const SNAPSHOT_RETENTION_DAYS = 30; // rolling daily snapshots
const ARCHIVE_AFTER_DAYS = 730; // 2年 — matches how far back the store itself treats as "recent"

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}

const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const storage = new Storage({ credentials: creds, projectId: creds.project_id });

function todayStamp() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

async function saveCompressed(bucket, path, data) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  await bucket.file(path).save(gz, {
    contentType: "application/json",
    metadata: { contentEncoding: "gzip" },
  });
}

// Fetches only transactions with ts > afterTs for one customer, using the ts
// index rather than downloading the customer's whole history. Uses
// startAt(afterTs + 1) rather than startAfter() — the newer startAfter()
// filter has been unreliable over the REST transport some Admin SDKs use,
// while startAt() is the long-standing, universally supported one.
async function fetchNewTransactions(db, base, customerId, afterTs) {
  const snap = await db
    .ref(`${base}/transactions/${customerId}`)
    .orderByChild("ts")
    .startAt(afterTs + 1)
    .get();
  return snap.val() || {};
}

// Fetches transactions with ts <= cutoff — the ones due for archiving. Once
// a run archives everything past the cutoff, later runs only ever see the
// small number of entries that newly crossed it, not the whole backlog
// again.
async function fetchOldTransactions(db, base, customerId, cutoff) {
  const snap = await db
    .ref(`${base}/transactions/${customerId}`)
    .orderByChild("ts")
    .endAt(cutoff)
    .get();
  return snap.val() || {};
}

exports.handler = async () => {
  if (!BUCKET_NAME) {
    return { statusCode: 500, body: JSON.stringify({ error: "BACKUP_BUCKET_NAMEが未設定です" }) };
  }

  const db = admin.database();
  const bucket = storage.bucket(BUCKET_NAME);
  const stamp = todayStamp();
  const now = Date.now();
  const archiveCutoff = now - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const results = [];

  const storeIds = Object.keys((await db.ref("storeList").get()).val() || {});

  for (const storeId of storeIds) {
    const base = `stores/${storeId}`;

    // ---- Full copy of the small stuff — doesn't grow with transaction
    // volume, so a full daily copy costs the same regardless of store age.
    const [accountsSnap, settingsSnap, statsSnap, privateSnap, rolesSnap] = await Promise.all([
      db.ref(`${base}/accounts`).get(),
      db.ref(`${base}/storeSettings`).get(),
      db.ref(`${base}/stats`).get(),
      db.ref(`${base}/private`).get(),
      db.ref(`${base}/roles`).get(),
    ]);
    const accounts = accountsSnap.val() || {};

    await saveCompressed(bucket, `${storeId}/${stamp}/full.json.gz`, {
      accounts,
      storeSettings: settingsSnap.val() || {},
      stats: statsSnap.val() || {},
      private: privateSnap.val() || {},
      roles: rolesSnap.val() || {},
    });

    // ---- Incremental transactions, one ranged query per customer ----
    const watermarkRef = db.ref(`${base}/backupWatermark`);
    const lastTs = (await watermarkRef.get()).val() || 0;
    const customerIds = Object.keys(accounts);

    const newTx = {};
    let newCount = 0;
    for (const customerId of customerIds) {
      const entries = await fetchNewTransactions(db, base, customerId, lastTs);
      if (Object.keys(entries).length > 0) {
        newTx[customerId] = entries;
        newCount += Object.keys(entries).length;
      }
    }
    if (newCount > 0) {
      await saveCompressed(bucket, `${storeId}/${stamp}/transactions-incremental.json.gz`, newTx);
    }
    await watermarkRef.set(now);

    // ---- Archive anything past the cutoff, then remove it from the live
    // database. The archive file is permanent (never pruned) — it's the
    // only remaining copy of this data once it's gone from live.
    const archived = {};
    const liveUpdates = {};
    let archivedCount = 0;
    for (const customerId of customerIds) {
      const oldEntries = await fetchOldTransactions(db, base, customerId, archiveCutoff);
      const keys = Object.keys(oldEntries);
      if (keys.length === 0) continue;
      archived[customerId] = oldEntries;
      archivedCount += keys.length;
      for (const key of keys) {
        liveUpdates[`${base}/transactions/${customerId}/${key}`] = null;
      }
    }
    if (archivedCount > 0) {
      await saveCompressed(bucket, `archives/${storeId}/${stamp}.json.gz`, archived);
      await db.ref().update(liveUpdates);
    }

    results.push({ storeId, newTransactions: newCount, archived: archivedCount });
  }

  // ---- Prune only the rolling daily snapshots — archives/ is permanent ----
  const cutoff = now - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const storeId of storeIds) {
    const [files] = await bucket.getFiles({ prefix: `${storeId}/` });
    for (const file of files) {
      const [meta] = await file.getMetadata();
      if (new Date(meta.timeCreated).getTime() < cutoff) {
        await file.delete().catch(() => {});
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ stores: storeIds.length, results }) };
};
