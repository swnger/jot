<script lang="ts">
  import { onMount } from "svelte";

  export let data: { mode: "login" | "setup" };

  const ownerTokenKey = "md_owner_token";

  let mode = data.mode;
  let password = "";
  let confirmPassword = "";
  let errorMessage = "";
  let passwordInput: HTMLInputElement;

  $: title = mode === "setup" ? "Set password" : "Sign in";
  $: heading = mode === "setup" ? "Set the password" : "Enter the password";
  $: hint = mode === "setup"
    ? "First startup. This becomes the single owner password for the instance."
    : "This instance uses one password and per-device tokens.";

  onMount(() => {
    paintThemeButtons();
    passwordInput?.focus();
    void restoreOwnerSession().then((restored) => {
      if (restored) {
        window.location.replace("/");
      }
    });
  });

  async function submit() {
    errorMessage = "";
    const endpoint = mode === "setup" ? "/api/auth/setup" : "/api/auth/login";

    try {
      const payload = await api(endpoint, {
        password,
        confirmPassword,
      });
      window.localStorage.setItem(payload.ownerLocalStorageTokenKey || ownerTokenKey, payload.token);
      await restoreOwnerSession();
      window.location.replace("/");
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Request failed.";
    }
  }

  async function restoreOwnerSession() {
    const token = window.localStorage.getItem(ownerTokenKey);
    if (!token) {
      return false;
    }

    try {
      await api("/api/auth/token", { token });
      return true;
    } catch {
      window.localStorage.removeItem(ownerTokenKey);
      return false;
    }
  }

  async function api(url: string, body: Record<string, string>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  }

  function paintThemeButtons() {
    const themeIcon = window.__themeIcon;
    if (!themeIcon) return;
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.innerHTML = themeIcon(document.documentElement.getAttribute("data-theme") || "dark");
    });
  }
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="page-shell auth-shell" data-auth-mode={mode}>
  <button type="button" class="text-button theme-toggle auth-theme-toggle" aria-label="Toggle theme"></button>
  <main class="auth-layout">
    <h1>{heading}</h1>
    <p class="auth-hint">{hint}</p>
    <p class:hidden={!errorMessage} class="auth-error">{errorMessage}</p>
    <form class="auth-form" on:submit|preventDefault={submit}>
      <input
        bind:this={passwordInput}
        bind:value={password}
        name="password"
        type="password"
        autocomplete={mode === "setup" ? "new-password" : "current-password"}
        placeholder="Password"
        minlength="8"
        required
      />
      {#if mode === "setup"}
        <input
          bind:value={confirmPassword}
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="Confirm password"
          minlength="8"
          required
        />
      {/if}
      <div class="auth-actions">
        <button type="submit">{mode === "setup" ? "Save password" : "Sign in"}</button>
      </div>
    </form>
  </main>
</div>
