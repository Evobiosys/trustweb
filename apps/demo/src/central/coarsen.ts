/**
 * Turn a local match plus the holder's own typed abstraction into the ONLY
 * thing that may ever leave the device for the central index: coarse facets
 * plus a sealed body.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FUNCTION MUST DROP, PROVABLY (handover section 1)
 * ---------------------------------------------------------------------------
 * Raw vault or message text, message author names, any street address or
 * house number, contact identifiers, and any free text the holder did not
 * explicitly type into the publish form. `coarsenForPublish` below takes a
 * `LocalMatchInput` carrying exactly the fields that must never survive
 * (`rawText`, `authorNames`, `incidentalFreeText`) and its body never reads
 * `input.match` at all -- not "reads it and filters it", reads NOTHING from
 * it. The only text that is ever sealed is `input.form.abstractionText`,
 * whatever the holder explicitly typed into the publish form. If a future
 * edit makes this function read anything off `input.match`, that edit is the
 * regression `central_adapter.test.ts`'s coarsen tests exist to catch.
 *
 * ---------------------------------------------------------------------------
 * SEALING
 * ---------------------------------------------------------------------------
 * AES-GCM via Web Crypto, IV is 12 random bytes from `crypto.getRandomValues`
 * (via `../crypto`'s `randomBytes`) on every call, prepended to the
 * ciphertext, the same combined-buffer framing `gate.ts`'s
 * `sealAnswerEnvelope` already uses. The IV is never derived from the
 * declaration id or any other identifier -- that is defect C-02 on the demo
 * relay's answer path (a different unit); this path must not repeat it. Two
 * seals of the identical plaintext therefore produce different ciphertexts,
 * on purpose (see this file's test coverage).
 *
 * `authorCommitment` is a salted SHA-256 of the holder DID, hex encoded. The
 * salt is a fixed, code-level domain-separation string, not a per-call
 * random value: the commitment must stay EQUAL across every publish the same
 * holder ever makes (the server counts distinct `authorCommitment` values
 * for the k-anonymity floor, and `backtrace`/`clearAll` key off the same
 * value), which a random salt would break.
 */

import { randomBytes, seal, toB64u } from '../crypto'
import type { DeclarationFacets } from './types'

/**
 * Everything a local match could offer that must NEVER reach the central
 * index. Accepted here only so a caller has one obvious place to hand this
 * material over and be told "no" -- see the module doc comment above:
 * `coarsenForPublish` never reads any field of this type.
 */
export interface LocalMatchInput {
  /** Raw vault/chat text the match was found in. NEVER published. */
  rawText?: string
  /** Names of message authors involved in the match. NEVER published. */
  authorNames?: string[]
  /** Street addresses, house numbers or other precise-location text that
   *  surfaced in the match. NEVER published. */
  addresses?: string[]
  /** Phone numbers, emails or other contact identifiers. NEVER published. */
  contactIdentifiers?: string[]
  /** Any other free text surrounding the match that the holder did not
   *  explicitly type into the publish form. NEVER published. */
  incidentalFreeText?: string[]
}

/** What the holder explicitly typed into the publish form, plus the coarse
 *  choices they made there. This, and only this, is the source of a
 *  published declaration's content. */
export interface PublishFormInput {
  /** Template category, copied verbatim onto `DeclarationFacets.category`. */
  category: string
  /** Coarse region the holder picked, e.g. 'AT-9'. Never an address. */
  regionCode: string
  /** Whether the template is flagged sensitive; drives asker protection
   *  downstream (`@resource-web/wot-policy`'s `protectAsker`). */
  sensitive: boolean
  /** The holder's own device DID. Never sent in the clear -- only its salted
   *  hash (`authorCommitment`) leaves the device. */
  holderDid: string
  /** The ONLY text this module ever seals: what the holder explicitly typed
   *  into the publish form. */
  abstractionText: string
}

export interface CoarsenInput {
  /** Present so a caller has a place to hand over local-match material and
   *  be told it is dropped. See the module doc comment: this field is never
   *  read by `coarsenForPublish`. */
  match: LocalMatchInput
  form: PublishFormInput
  /** Sealing key: the holder's own device key. The operator never holds it. */
  key: CryptoKey
}

export interface CoarsenedPublication {
  facets: DeclarationFacets
  sealedBody: string
}

const AUTHOR_COMMITMENT_SALT = 'ew-central-author-commitment-v1'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Salted SHA-256 of the holder DID, hex encoded. Deterministic in the salt
 * and the DID alone, so the same holder always produces the same
 * commitment -- see the module doc comment on why that must hold.
 */
export async function authorCommitmentOf(holderDid: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${AUTHOR_COMMITMENT_SALT}:${holderDid}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

/**
 * Seal `plaintext` under `key` with a fresh random 12-byte IV, framed as
 * `iv || ciphertext`, base64url-encoded to a single string. See the module
 * doc comment: the IV is never derived from an id.
 */
export async function sealBody(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randomBytes(12)
  const ciphertext = await seal(key, iv, new TextEncoder().encode(plaintext))
  const combined = new Uint8Array(iv.length + ciphertext.length)
  combined.set(iv, 0)
  combined.set(ciphertext, iv.length)
  return toB64u(combined)
}

/**
 * Turn a local match plus the holder's own typed abstraction into
 * `{ facets, sealedBody }` -- the only shape that may leave the device for
 * the central index. See the module doc comment for what is dropped and why.
 */
export async function coarsenForPublish(input: CoarsenInput): Promise<CoarsenedPublication> {
  const { form, key } = input
  const facets: DeclarationFacets = {
    category: form.category,
    regionCode: form.regionCode,
    authorCommitment: await authorCommitmentOf(form.holderDid),
    sensitive: form.sensitive,
  }
  const sealedBody = await sealBody(key, form.abstractionText)
  return { facets, sealedBody }
}
