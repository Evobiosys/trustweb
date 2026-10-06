/**
 * The two sheets around installing (moved out of main.ts in wave 1733 round B,
 * unchanged in behaviour): the Install sheet (install.ts decides the path for
 * this browser) and "Bring your demo along?", which asks before the demo's
 * carry-over (demo_to_live.ts) is merged into a live app that already has people.
 */
import { el } from '../../demo/src/ui/dom'
import { dropCarry, mergeCarryOver } from './demo_to_live'
import type { CarryOver } from './demo_to_live'
import { installSheetContent } from './install'
import type { AppState } from './model'
import { S } from './strings'

export interface InstallSheetsHooks {
  sheet: HTMLElement
  state: () => AppState | null
  /** The record after a merge (saved by the caller). */
  setState: (s: AppState) => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  render: () => void
  backup: { available(): boolean | null; probe(): Promise<void> }
  /** Takes the person to the backup card (Inventory). */
  openBackup: () => void
}

export interface InstallSheets {
  openInstall(): void
  /** The live app already has people: the carry-over is merged only on a yes, never overwriting anything. */
  carryAsk(c: CarryOver, then: () => void): void
}

const INSTALL_KIND = 'install'

export function createInstallSheets(h: InstallSheetsHooks): InstallSheets {
  const showing = (): boolean => h.sheet.dataset.kind === INSTALL_KIND

  function openInstall(): void {
    const s = h.state()
    const hasData = Boolean(s && (s.people.length || s.inventory.length || s.meetings?.length))
    if (hasData && h.backup.available() === null) void h.backup.probe().then(() => { if (showing()) openInstall() })
    h.openSheet(installSheetContent({
      hasData,
      backupAvailable: h.backup.available(),
      openBackup: () => {
        h.closeSheet()
        h.openBackup()
        h.toast(S.instMoveToast)
        document.getElementById('backup-slot')?.scrollIntoView({ block: 'center' })
      },
      redraw: () => { if (showing()) openInstall() },
      toast: h.toast,
    }))
    h.sheet.dataset.kind = INSTALL_KIND
  }

  function carryAsk(c: CarryOver, then: () => void): void {
    const done = (merge: boolean): void => {
      const s = h.state()
      if (merge && s) h.setState(mergeCarryOver(s, c))
      dropCarry()
      h.closeSheet()
      h.render()
      h.toast(merge ? S.carryMerged : S.carryCancelled)
      then()
    }
    h.openSheet([
      el('h3', {}, [S.carryAskTitle]),
      el('p', { class: 'meta' }, [S.carryAskBody(c.people.length, c.inventory.length, h.state()?.people.length ?? 0)]),
      el('button', { class: 'btn btn-electric', 'data-carry': 'merge', onclick: () => done(true) }, [S.carryMerge]),
      el('button', { class: 'btn btn-ghost', 'data-carry': 'cancel', onclick: () => done(false) }, [S.carryCancel]),
    ])
  }

  return { openInstall, carryAsk }
}
