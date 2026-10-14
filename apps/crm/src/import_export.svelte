<script lang="ts">
  import { forgetImport, importText, store } from './state.svelte'
  import { Source } from './storage'
  import { S } from './strings'

  let importFailed = $state(false)

  async function onFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      importFailed = !importText(await file.text())
    } catch {
      importFailed = true
    }
  }

  function forget(): void {
    importFailed = false
    forgetImport()
  }
</script>

<div class="import-row">
  <label class="file-btn">
    {S.importFile}
    <input type="file" accept="application/json" onchange={onFile} />
  </label>
  {#if store.source === Source.Imported}
    <button class="quiet" onclick={forget}>{S.forgetImport}</button>
  {/if}
</div>
{#if importFailed}<p class="warn" role="alert">{S.importBad}</p>{/if}
