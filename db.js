const DB_NAME = 'chm-shelf-v1';
const DB_VERSION = 1;

let databasePromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'key' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

export const shelfDb = {
  async allBooks() {
    const db = await openDatabase();
    const books = await requestAsPromise(db.transaction('books').objectStore('books').getAll());
    return books.sort((a, b) => b.addedAt - a.addedAt);
  },

  async getBook(id) {
    const db = await openDatabase();
    return requestAsPromise(db.transaction('books').objectStore('books').get(id));
  },

  async putBook(book) {
    const db = await openDatabase();
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    await transactionDone(tx);
  },

  async deleteBook(id) {
    const db = await openDatabase();
    const tx = db.transaction(['books', 'files'], 'readwrite');
    tx.objectStore('books').delete(id);
    const index = tx.objectStore('files').index('bookId');
    const request = index.openKeyCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        tx.objectStore('files').delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    await transactionDone(tx);
  },

  async putFiles(bookId, files, onProgress) {
    const db = await openDatabase();
    const chunkSize = 120;
    for (let start = 0; start < files.length; start += chunkSize) {
      const chunk = files.slice(start, start + chunkSize);
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      for (const file of chunk) {
        store.put({
          key: `${bookId}\u0000${file.path}`,
          bookId,
          path: file.path,
          type: file.type,
          data: file.data,
        });
      }
      await transactionDone(tx);
      if (onProgress) onProgress(Math.min(start + chunkSize, files.length), files.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  },

  async getFile(bookId, path) {
    const db = await openDatabase();
    return requestAsPromise(
      db.transaction('files').objectStore('files').get(`${bookId}\u0000${path}`)
    );
  },

  async getFiles(bookId) {
    const db = await openDatabase();
    const index = db.transaction('files').objectStore('files').index('bookId');
    return requestAsPromise(index.getAll(IDBKeyRange.only(bookId)));
  },
};
