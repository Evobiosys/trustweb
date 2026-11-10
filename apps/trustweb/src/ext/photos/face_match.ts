// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails (opt-in: Settings > Advanced > "Match faces on this device (alpha)"): the interface for matching faces ON THIS DEVICE. An Embedder
 * turns a thumbnail into a vector (null: no face); clusterFaces groups the close ones; the owner names a cluster once and every photo in it follows.
 * Nothing leaves the device: no embedder in this app calls a network. Only a deterministic STUB ships (it reads bytes, not faces). The real model
 * (insightface / CLIP) runs on pc24 as a job over the LUKS photos and reports clusters only, see DEVLOG/wave40/photo-rails/SPEC-face-cluster-pc24.txt.
 */
export interface Embedder {
  id: string
  /** True for a placeholder that does not recognise faces. The UI says so. */
  stub: boolean
  /** A unit vector for the face in the thumbnail, or null when there is none. */
  embed(thumb: Blob): Promise<number[] | null>
}

export interface FaceCluster { id: string; photoIds: string[] }

const DIMS = 16

/** Deterministic placeholder: a 16-bucket histogram of the thumbnail's bytes, length 1. Equal pictures match; it knows nothing about faces. */
export const stubEmbedder: Embedder = {
  id: 'stub-bytes-v1',
  stub: true,
  async embed(thumb) {
    const v = new Array<number>(DIMS).fill(0)
    for (const b of new Uint8Array(await thumb.arrayBuffer())) v[b % DIMS]++
    const n = Math.hypot(...v)
    return n ? v.map((x) => x / n) : null
  },
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Leader clustering in input order: a photo joins the first cluster whose first member it matches at `threshold`, else starts one. No face: no cluster. */
export function clusterFaces(items: readonly { photoId: string; vec: readonly number[] | null }[], threshold: number): FaceCluster[] {
  const leaders: { vec: readonly number[]; cluster: FaceCluster }[] = []
  for (const it of items) {
    if (!it.vec) continue
    const hit = leaders.find((l) => cosine(l.vec, it.vec as readonly number[]) >= threshold)
    if (hit) hit.cluster.photoIds.push(it.photoId)
    else leaders.push({ vec: it.vec, cluster: { id: `c${leaders.length + 1}`, photoIds: [it.photoId] } })
  }
  return leaders.map((l) => l.cluster)
}

/** The person more than half of the cluster's photos already belong to, if any. */
export function suggestForCluster(c: FaceCluster, peopleOf: Readonly<Record<string, readonly string[]>>): string | undefined {
  const count = new Map<string, number>()
  for (const id of c.photoIds) for (const p of peopleOf[id] ?? []) count.set(p, (count.get(p) ?? 0) + 1)
  const [best] = [...count.entries()].sort((a, b) => b[1] - a[1])
  return best && best[1] * 2 > c.photoIds.length ? best[0] : undefined
}
