// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: the browser side of photo_ingest.ts. Decoding and drawing into a canvas drops everything the camera wrote (EXIF: place, time,
 * device); the orientation is applied while decoding. DOM and crypto only; the rules stay in photo_ingest.ts.
 */
import { fitSize } from '../../image_store'
import { quotaRoom } from './photo_model'
import type { Scaled, Scaler } from './photo_ingest'

const QUALITY = 0.82

/** The picture as a JPEG whose longer side is at most `side`; never scaled up. Transparent areas turn white. Throws when the browser cannot decode it. */
export const scaleJpeg: Scaler = async (file, side): Promise<Scaled> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height, side)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) throw new Error('no canvas')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, w, h)
    g.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', QUALITY))
    return { blob, w, h }
  } finally {
    bitmap.close()
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What the browser says it holds and may hold; zeros when it does not tell. */
export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  try { const e = await navigator.storage?.estimate?.(); return { usage: e?.usage ?? 0, quota: e?.quota ?? 0 } } catch { return { usage: 0, quota: 0 } }
}

export async function roomFor(bytes: number): Promise<boolean> {
  const e = await storageEstimate()
  return quotaRoom(e.usage, e.quota, bytes)
}
