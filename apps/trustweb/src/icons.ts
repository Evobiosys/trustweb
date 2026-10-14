/**
 * The app's icons as SVG markup (moved out of main.ts in wave 1733).
 */
// Icons: web, feed, inventory, query, meet, solo and call are this app's own; mic, pause, play, send,
// x, qr, handshake, settings (a cog, never a sun-like icon: owner 2026-10-05),
// users and info are Lucide icons (lucide.dev, ISC licence).
export const ICONS: Record<string, string> = {
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="10.5" stroke-dasharray="2 3"/></svg>',
  feed: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  // The Web Curator: a ring with its dot.
  curator: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
  inventory: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
  query: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9.6 9.5a2.4 2.4 0 1 1 3.6 2c-.8.5-1.2 1-1.2 1.8"/><path d="M12 16.6h.01"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M6 3l14 9-14 9z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3.7 3.05a.5.5 0 0 0-.68.63l2.84 7.62a2 2 0 0 1 0 1.4l-2.84 7.62a.5.5 0 0 0 .68.63l18-8.5a.5.5 0 0 0 0-.9z"/><path d="M6 12h16"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>',
  meet: '<svg viewBox="0 0 24 24"><circle cx="6.2" cy="5.6" r="2.7" fill="currentColor" stroke="none"/><circle cx="17.8" cy="5.6" r="2.7" fill="currentColor" stroke="none"/><rect x="2" y="10" width="7" height="11.5" rx="2.6" fill="currentColor" stroke="none"/><rect x="15" y="10" width="7" height="11.5" rx="2.6" fill="currentColor" stroke="none"/><path d="M7.5 12.2l3.6 2.9" stroke-width="2.6"/><path d="M16.5 12.2l-3.6 2.9" stroke-width="2.6"/></svg>',
  // "Just me" (owner 2026-10-06): the Meeting icon's person on its own, three small sound arcs at the mouth.
  solo: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="5.6" r="2.7" fill="currentColor" stroke="none"/><rect x="3" y="10" width="9" height="11.5" rx="3" fill="currentColor" stroke="none"/><path d="M14.6 7.6a3 3 0 0 1 0 4"/><path d="M17.4 5.6a6 6 0 0 1 0 8"/><path d="M20.2 3.6a9 9 0 0 1 0 12"/></svg>',
  handshake: '<svg viewBox="0 0 24 24"><path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  // "Call into your web": only the sound waves (owner 2026-10-05: "simpler and
  // less confusing"), the call going out and the resonance coming back.
  call: '<svg viewBox="0 0 24 24"><path d="M5.5 8.5a5 5 0 0 1 0 7"/><path d="M9.5 5.5a9.5 9.5 0 0 1 0 13"/><path d="M13.5 2.8a13.5 13.5 0 0 1 0 18.4"/></svg>',
  // Wave 6h, S3: "Signal" as a plain speech bubble with a dotted rim, drawn in the text colour (no brand asset, no brand colour).
  signal: '<svg viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5Z" stroke-dasharray="2.2 1.6"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.4"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>',
}
