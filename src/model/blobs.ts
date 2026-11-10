import { useEffect, useState } from 'react'

// Drawings are too big for localStorage (a Vectorworks set runs to 20 MB), so the original PDFs and
// the rendered plan underlays live in IndexedDB, keyed from the design. Nothing here leaves the device.

const DB_NAME = 'selfriser'
const STORE = 'blobs'
let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('No IndexedDB here'))
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { opening = null; reject(req.error) }
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const req = op(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

export const putBlob = (key: string, blob: Blob) => run('readwrite', (s) => s.put(blob, key)).then(() => key)
export const getBlob = (key: string) => run<Blob | undefined>('readonly', (s) => s.get(key)).catch(() => undefined)
export const deleteBlob = (key: string) => run('readwrite', (s) => s.delete(key)).catch(() => undefined)

/** An object URL for a stored blob, revoked when the key changes or the component goes away. */
export function useBlobUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!key) return
    let made: string | null = null
    let live = true
    getBlob(key).then((b) => {
      if (!live || !b) return
      made = URL.createObjectURL(b)
      setUrl(made)
    })
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [key])
  return url
}
