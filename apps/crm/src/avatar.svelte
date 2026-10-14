<script lang="ts">
  import { avatarHue, initials } from './display'

  interface Props {
    id: string
    name: string
  }
  const { id, name }: Props = $props()
  const hue = $derived(avatarHue(id))
  const text = $derived(initials(name))
</script>

<span class="ava hue-{hue}" aria-hidden="true">{text}</span>
