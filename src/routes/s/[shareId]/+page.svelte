<script lang="ts">
  import LegacyAppShell from "$lib/components/LegacyAppShell.svelte";

  export let data: { shareId: string; title: string; shareAccess: "view" | "comment" | "edit" };
</script>

<LegacyAppShell
  title={data.title}
  page="public"
  shareId={data.shareId}
  shareAccess={data.shareAccess}
  mermaid
/>
