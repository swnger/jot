<script lang="ts">
  export let title: string;
  export let page: "list" | "editor" | "public";
  export let noteId = "";
  export let shareId = "";
  export let shareAccess = "";
  export let mermaid = false;
</script>

<svelte:head>
  <title>{title}</title>
  <script src="/static/components.js"></script>
  {#if mermaid}
    <script type="module">
      import mermaid from "/static/mermaid/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark",
      });
      window.__mermaid = mermaid;
      if (window.__renderMermaid) {
        const container = document.getElementById("anchorTextRoot") || document.getElementById("previewContent");
        if (container) window.__renderMermaid(container);
      }
    </script>
  {/if}
  <script src="/static/app.js" defer></script>
</svelte:head>

<div
  id="app"
  class="page-shell app-page"
  data-page={page}
  data-note-id={noteId}
  data-share-id={shareId}
  data-share-access={shareAccess}
></div>
