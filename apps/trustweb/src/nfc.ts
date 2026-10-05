/**
 * NFC, where a web page can use it at all.
 *
 * Web NFC (NDEFReader) exists only in Chrome on Android, on secure pages. It
 * reads and writes NFC tags; it cannot do phone-to-phone exchange. So the
 * honest offer is: write this phone's connect link onto a tag or card, which
 * the other person then taps. Everywhere else the QR code is the way.
 */

interface NdefWriter {
  write(message: { records: { recordType: 'url'; data: string }[] }): Promise<void>
}

type NdefCtor = new () => NdefWriter

function ctor(): NdefCtor | null {
  return (window as unknown as { NDEFReader?: NdefCtor }).NDEFReader ?? null
}

export function nfcWriteSupported(): boolean {
  return window.isSecureContext && ctor() !== null
}

/** Resolves once a tag held to the phone has the link written on it. */
export async function writeLinkToTag(url: string): Promise<void> {
  const C = ctor()
  if (!C) throw new Error('NFC unavailable')
  await new C().write({ records: [{ recordType: 'url', data: url }] })
}
