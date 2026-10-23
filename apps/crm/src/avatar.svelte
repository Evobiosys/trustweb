<script lang="ts">
  import { avatarHue, initials } from './display'

  interface Props {
    id: string
    name: string
    /** A picture (an image URL) in place of the initials. */
    src?: string
  }
  const { id, name, src }: Props = $props()
  const hue = $derived(avatarHue(id))
  const text = $derived(initials(name))
</script>

<span class="ava hue-{hue}" class:pic={src} aria-hidden="true" style:background-image={src ? `url("${src}")` : undefined}>{src ? '' : text}</span>
