<script lang="ts">
  import LegacyAppShell from "$lib/components/LegacyAppShell.svelte";

  export let data: { id: string };
</script>

<LegacyAppShell title="Note" page="editor" noteId={data.id} mermaid />
