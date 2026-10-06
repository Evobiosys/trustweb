<script lang="ts">
  import type { NoteLine } from '../../trustweb/src/model'
  import { tagText } from './display'

  interface Props {
    line: Pick<NoteLine, 'tag' | 'customTag'>
  }
  const { line }: Props = $props()
  const text = $derived(tagText(line))
</script>

<span class="tagpill tag-{line.tag}">{text}</span>
