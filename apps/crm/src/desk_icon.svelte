<script lang="ts">
  import { ICONS } from './desk_icons'
  import type { IconName } from './desk_icons'

  interface Props {
    name: IconName
    size?: number
  }
  const { name, size = 20 }: Props = $props()
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[name]}</svg>
