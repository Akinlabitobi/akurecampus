// Forms filled in without a connection are kept on the device (IndexedDB,
// which survives closing the app) and sent automatically once the
// connection is back: when the app opens, when the browser reports it's
// online again, and when the app comes back to the foreground.
//
// Only public forms use this. Each queued request carries the same
// submissionId the server already uses to ignore duplicates, so a resend
// after a lost response never creates two records.

const DB_NAME = "harvesters-akure";
const STORE = "outbox";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const result = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export const outbox = {
  add: item => withStore("readwrite", store => store.put(item)),
  remove: id => withStore("readwrite", store => store.delete(id)),
  all: () => withStore("readonly", store => store.getAll())
};

// True when a fetch failed because there was no connection (as opposed to
// the server answering with an error, which must be shown, not queued).
export function isNetworkFailure(error) {
  return !navigator.onLine || error instanceof TypeError;
}

// POSTs JSON. When the device is offline, saves the request to the outbox
// instead and resolves { queued: true } so the form can say so.
export async function postOrQueue(url, body, label) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || "Something went wrong. Please try again."), { fromServer: true });
    return result;
  } catch (error) {
    if (error.fromServer || !isNetworkFailure(error)) throw error;
    await outbox.add({ id: body.submissionId || crypto.randomUUID(), url, body, label, savedAt: new Date().toISOString() });
    return { queued: true };
  }
}

let flushing = false;

// Sends everything waiting in the outbox. Network failures leave items in
// place for next time; a server rejection (e.g. an attendance code that has
// expired by the time it's sent) removes the item and is reported, since
// retrying would only fail again.
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return { sent: [], failed: [] };
  flushing = true;
  const sent = [];
  const failed = [];
  try {
    for (const item of await outbox.all()) {
      try {
        const response = await fetch(item.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body)
        });
        if (response.ok) {
          sent.push(item);
          await outbox.remove(item.id);
        } else if (response.status >= 400 && response.status < 500) {
          const result = await response.json().catch(() => ({}));
          failed.push({ ...item, error: result.error || "It was not accepted." });
          await outbox.remove(item.id);
        }
      } catch {
        break; // connection dropped again; try the rest later
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}
