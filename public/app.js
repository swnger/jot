(() => {
  const ownerTokenKey = window.__OWNER_TOKEN_KEY__ || "md_owner_token";
  const app = document.getElementById("app");
  const page = document.body.dataset.page;
  const noteId = document.body.dataset.noteId || "";
  const shareId = document.body.dataset.shareId || "";

  if (!app || !page) {
    return;
  }

  const isMobileDevice = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && "ontouchstart" in window && navigator.maxTouchPoints > 1);

  const themeIcon = window.__themeIcon || ((t) => t === "dark" ? "☀" : "☾");

  const shareAccess = document.body.dataset.shareAccess || "";

  const state = {
    page,
    noteId,
    shareId,
    shareAccess,
    note: null,
    viewer: null,
    threads: [],
    activeThreadId: null,
    visibleMatches: new Map(),
    pendingAnchor: null,
    saveTimer: null,
    renderTimer: null,
    searchTimer: null,
    layoutFrame: 0,
    saveStatus: "Saved",
    showResolved: false,
    showComments: true,
    modalOpen: false,
  };

  if (page === "list") {
    initListPage();
    return;
  }

  if (page === "editor") {
    initNotePage(false);
    return;
  }

  if (page === "public") {
    initNotePage(true);
  }

  function initListPage() {
    app.innerHTML = `
      <div class="app-root">
        <header class="topbar">
          <div class="topbar-left">
            <div class="topbar-title">notes</div>
          </div>
          <div class="topbar-right">
            <button type="button" class="icon-button" id="newNoteButton" aria-label="New note">+</button>
            <button type="button" class="icon-button ghost" id="settingsButton" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
            <button type="button" class="icon-button ghost" id="logoutButton" aria-label="Logout" title="Logout"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 11.5L14 8l-3.5-3.5M6 8h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button type="button" class="text-button theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="list-page">
          <div class="list-search-wrap">
            <input class="list-search" id="searchInput" type="text" placeholder="Search notes" autocomplete="off" />
          </div>
          <div class="note-list" id="noteList"></div>
        </main>
        <div class="modal-backdrop hidden" id="listModalBackdrop"></div>
      </div>
    `;

    const searchInput = document.getElementById("searchInput");
    const noteList = document.getElementById("noteList");
    const newNoteButton = document.getElementById("newNoteButton");
    const settingsButton = document.getElementById("settingsButton");
    const logoutButton = document.getElementById("logoutButton");
    const listModalBackdrop = document.getElementById("listModalBackdrop");

    newNoteButton.addEventListener("click", async () => {
      const payload = await api("/api/notes", { method: "POST" });
      window.location.href = `/notes/${payload.note.id}`;
    });

    logoutButton.addEventListener("click", logoutOwner);
    settingsButton.addEventListener("click", () => openSettingsModal());

    searchInput.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        loadNotes(searchInput.value);
      }, 160);
    });

    noteList.addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".note-delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        const id = deleteBtn.dataset.noteId;
        if (!id || !confirm("Delete this note?")) return;
        await api(`/api/notes/${id}`, { method: "DELETE" });
        loadNotes(searchInput.value);
        return;
      }
      const row = event.target.closest("[data-note-id]");
      if (!row) return;
      window.location.href = `/notes/${row.dataset.noteId}`;
    });

    loadNotes("");

    function openSettingsModal() {
      listModalBackdrop.classList.remove("hidden");
      listModalBackdrop.innerHTML = `
        <div class="modal settings-modal" role="dialog" aria-modal="true">
          <div class="settings-header">
            <h2 class="settings-title">Settings</h2>
            <button type="button" class="icon-button ghost" id="settingsClose" aria-label="Close">&times;</button>
          </div>
          <div class="settings-section">
            <div class="settings-section-header">
              <h3 class="settings-section-title">API Keys</h3>
              <button type="button" class="text-button" id="createKeyButton">+ new key</button>
            </div>
            <div id="apiKeysList"></div>
          </div>
        </div>
      `;

      const apiKeysList = document.getElementById("apiKeysList");
      const createKeyButton = document.getElementById("createKeyButton");

      function closeSettings() {
        listModalBackdrop.classList.add("hidden");
        listModalBackdrop.innerHTML = "";
      }

      document.getElementById("settingsClose").addEventListener("click", closeSettings);
      listModalBackdrop.addEventListener("click", (e) => { if (e.target === listModalBackdrop) closeSettings(); });

      createKeyButton.addEventListener("click", async () => {
        const label = prompt("Label for this API key:");
        if (!label) return;
        const result = await api("/api/keys", { method: "POST", body: { label } });
        await renderKeys();
        showNewKey(result.id, result.key);
      });

      apiKeysList.addEventListener("click", async (event) => {
        const copyBtn = event.target.closest("[data-copy-key]");
        if (copyBtn) {
          try {
            await navigator.clipboard.writeText(copyBtn.dataset.copyKey);
            copyBtn.classList.add("copy-success");
            setTimeout(() => copyBtn.classList.remove("copy-success"), 1200);
          } catch {}
          return;
        }
        const deleteBtn = event.target.closest("[data-delete-key]");
        if (!deleteBtn) return;
        if (!confirm("Delete this API key?")) return;
        await api(`/api/keys/${deleteBtn.dataset.deleteKey}`, { method: "DELETE" });
        renderKeys();
      });

      async function renderKeys() {
        const response = await api("/api/keys");
        apiKeysList.innerHTML = response.keys.length
          ? response.keys.map((key) => `
              <div class="api-key-row" data-key-id="${escapeHtml(key.id)}">
                <div class="api-key-info">
                  <span class="api-key-label">${escapeHtml(key.label)}</span>
                  <span class="api-key-meta">${escapeHtml(formatDate(key.createdAt))}</span>
                </div>
                <button type="button" class="icon-action danger" data-delete-key="${escapeHtml(key.id)}" aria-label="Delete key" title="Delete key"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.2 4.5V3.4c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9v1.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="m5 6.2.5 6.1c0 .4.4.7.8.7h3.4c.4 0 .8-.3.8-.7l.5-6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              </div>
            `).join("")
          : '<div class="api-keys-empty">No API keys yet.</div>';
      }

      function showNewKey(keyId, key) {
        const row = apiKeysList.querySelector(`[data-key-id="${keyId}"]`);
        if (!row) return;
        const existing = row.querySelector(".api-key-secret");
        if (existing) existing.remove();
        const secret = document.createElement("div");
        secret.className = "api-key-secret";
        secret.innerHTML = `<code>${escapeHtml(key)}</code><button type="button" class="icon-action" data-copy-key="${escapeHtml(key)}" aria-label="Copy key" title="Copy key"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>`;
        const deleteBtn = row.querySelector(".icon-action[data-delete-key]");
        row.insertBefore(secret, deleteBtn);
      }

      renderKeys();
    }

    async function loadNotes(query) {
      const response = await api(`/api/notes?q=${encodeURIComponent(query)}`);
      const hasNotes = response.notes.length > 0;
      const hasQuery = query.trim().length > 0;

      document.querySelector(".list-search-wrap").style.display = (hasNotes || hasQuery) ? "" : "none";

      if (!hasNotes && !hasQuery) {
        noteList.innerHTML = `<div class="empty-state-create"><p class="empty-state-text">No notes yet.</p><button type="button" class="empty-state-button" id="emptyCreateBtn">Create note</button></div>`;
        document.getElementById("emptyCreateBtn").addEventListener("click", async () => {
          const payload = await api("/api/notes", { method: "POST" });
          window.location.href = `/notes/${payload.note.id}`;
        });
        return;
      }

      noteList.innerHTML = hasNotes
        ? response.notes
            .map(
              (note) => `
                <div class="note-row" data-note-id="${escapeHtml(note.id)}">
                  <div class="note-row-content">
                    <div class="note-row-title">${escapeHtml(note.title || "untitled")}</div>
                    <div class="note-row-snippet">${escapeHtml(note.snippet || "Empty note")}</div>
                    <div class="note-row-meta">${escapeHtml(formatDate(note.updatedAt))}</div>
                  </div>
                  <button type="button" class="icon-action danger note-delete-btn" data-note-id="${escapeHtml(note.id)}" aria-label="Delete note" title="Delete note"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.2 4.5V3.4c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9v1.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="m5 6.2.5 6.1c0 .4.4.7.8.7h3.4c.4 0 .8-.3.8-.7l.5-6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                </div>
              `,
            )
            .join("")
        : `<div class="empty-state">No notes match your search.</div>`;
    }
  }

  function initNotePage(isPublic) {
    const isPublicEdit = isPublic && shareAccess === "edit";
    const isPublicView = isPublic && shareAccess === "view";
    app.innerHTML = isPublicEdit ? renderPublicEditorLayout() : isPublic ? renderPublicLayout(isPublicView) : renderEditorLayout();

    const previewScroll = document.getElementById("previewScroll");
    const previewCanvas = document.getElementById("previewCanvas");
    const previewContent = document.getElementById("previewContent");
    const threadRail = document.getElementById("threadRail");
    const highlightLayer = document.getElementById("highlightLayer");
    const selectionBubble = document.getElementById("selectionBubble");
    const modalBackdrop = document.getElementById("modalBackdrop");
    const topbarTitle = document.getElementById("topbarTitle");
    const titleInput = document.getElementById("titleInput");
    const editorTextarea = document.getElementById("editorTextarea");
    const shareButton = document.getElementById("shareButton");
    const notesButton = document.getElementById("notesButton");
    const newNoteButton = document.getElementById("newNoteButton");
    const resolvedButton = document.getElementById("resolvedButton");
    const commentsButton = document.getElementById("commentsButton");
    const logoutButton = document.getElementById("logoutButton");
    const saveStatus = document.getElementById("saveStatus");
    const commenterLabel = document.getElementById("commenterLabel");
    const commentFab = document.getElementById("commentFab");
    const previewFab = document.getElementById("previewFab");
    const previewCloseButton = document.getElementById("previewCloseButton");

    const refs = {
      previewScroll,
      previewCanvas,
      previewContent,
      threadRail,
      highlightLayer,
      selectionBubble,
      modalBackdrop,
      topbarTitle,
      titleInput,
      editorTextarea,
      shareButton,
      notesButton,
      newNoteButton,
      resolvedButton,
      commentsButton,
      logoutButton,
      saveStatus,
      commenterLabel,
      commentFab,
      previewFab,
      previewCloseButton,
    };

    if (notesButton) {
      notesButton.addEventListener("click", () => {
        window.location.href = "/";
      });
    }

    if (newNoteButton) {
      newNoteButton.addEventListener("click", async () => {
        const payload = await api("/api/notes", { method: "POST" });
        window.location.href = `/notes/${payload.note.id}`;
      });
    }

    if (shareButton) {
      shareButton.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSharePopover(refs);
      });
    }

    if (resolvedButton) {
      resolvedButton.addEventListener("click", () => {
        state.showResolved = !state.showResolved;
        updateResolvedButton(resolvedButton);
        syncThreadLayout(refs);
      });
    }

    if (commentsButton) {
      commentsButton.addEventListener("click", () => {
        state.showComments = !state.showComments;
        updateCommentsButton(commentsButton);
        syncThreadLayout(refs);
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", logoutOwner);
    }

    let collabEditor = null;

    function initCollabEditor() {
      if (!editorTextarea) return;
      import("/static/collab-editor.js").then(({ createCollabEditor }) => {
        collabEditor = createCollabEditor(editorTextarea, {
          noteId: isPublic ? undefined : noteId,
          shareId: isPublic ? shareId : undefined,
          name: isPublic ? (state.viewer?.commenterName || "Anonymous") : "Owner",
          onReady: (payload) => {
            state.note = {
              ...(state.note || {}),
              id: payload.noteId,
              title: payload.title,
              shareId: payload.shareId,
              markdown: payload.markdown,
            };
            if (refs.titleInput && document.activeElement !== refs.titleInput) {
              refs.titleInput.value = payload.title;
            }
            if (refs.topbarTitle) refs.topbarTitle.textContent = payload.title || "untitled";
            scheduleRender(refs);
          },
          onTextChange: (text) => {
            if (!state.note) {
              state.note = { id: noteId || "", title: "untitled", shareId: shareId || "", markdown: text };
            } else {
              state.note.markdown = text;
            }
            scheduleRender(refs);
          },
          onConnectionChange: (connected) => {
            setSaveStatus(refs, connected ? "" : "Disconnected");
            const banner = document.getElementById("disconnectedBanner");
            if (banner) banner.classList.toggle("hidden", connected);
          },
          onThreadsUpdated: () => {
            reloadThreads(isPublic);
          },
        });
      });
    }

    if (editorTextarea && !isPublic) {
      initCollabEditor();
    }

    if (titleInput) {
      let titleSaveTimer = null;
      titleInput.addEventListener("input", () => {
        if (!state.note) {
          return;
        }
        state.note.title = titleInput.value;
        clearTimeout(titleSaveTimer);
        titleSaveTimer = setTimeout(async () => {
          await api(`/api/notes/${noteId}`, {
            method: "PUT",
            body: { title: titleInput.value },
          });
        }, 500);
      });
    }

    if (selectionBubble) {
      selectionBubble.addEventListener("click", () => {
        if (!state.pendingAnchor) {
          return;
        }
        const anchor = state.pendingAnchor;
        window.getSelection()?.removeAllRanges();
        selectionBubble.classList.add("hidden");
        openComposerModal({
          mode: "thread",
          anchor,
          refs,
        });
      });
    }

    if (previewScroll) previewScroll.addEventListener("scroll", () => scheduleLayout(refs));
    window.addEventListener("resize", () => scheduleLayout(refs));

    document.addEventListener("selectionchange", () => {
      if (state.page === "list" || state.modalOpen) {
        return;
      }
      updateSelectionBubble(refs);
      updateCommentFab(refs);
    });

    if (previewFab) {
      previewFab.addEventListener("click", () => {
        const stage = document.getElementById("previewStage");
        if (stage) {
          stage.classList.add("preview-open");
          previewFab.style.display = "none";
        }
      });
    }

    if (previewCloseButton) {
      previewCloseButton.addEventListener("click", () => {
        const stage = document.getElementById("previewStage");
        if (stage) {
          stage.classList.remove("preview-open");
          if (previewFab) {
            previewFab.style.display = "";
          }
        }
      });
    }

    // Swipe right to close preview on mobile
    {
      let touchStartX = 0;
      let touchStartY = 0;
      const previewStage = document.getElementById("previewStage");
      if (previewStage) {
        previewStage.addEventListener("touchstart", (e) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }, { passive: true });
        previewStage.addEventListener("touchend", (e) => {
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
          if (dx > 80 && dy < 100) {
            previewStage.classList.remove("preview-open");
            if (previewFab) {
              previewFab.style.display = "";
            }
          }
        }, { passive: true });
      }
    }

    if (previewCanvas) previewCanvas.addEventListener("click", (event) => {
      if (event.target.closest(".thread-rail") || event.target.closest(".selection-bubble")) {
        return;
      }
      const threadId = findAnchorAtPoint(event.clientX, event.clientY, highlightLayer);
      if (!threadId) {
        return;
      }
      const railVisible = threadRail && threadRail.offsetParent !== null;
      if (railVisible) {
        activateThread(threadId, refs, true);
      } else {
        openThreadDialog(threadId, refs, isPublic);
      }
    });

    if (commentFab) {
      commentFab.addEventListener("click", () => {
        if (!state.pendingAnchor) {
          return;
        }
        const anchor = state.pendingAnchor;
        window.getSelection()?.removeAllRanges();
        commentFab.style.display = "none";
        openComposerModal({
          mode: "thread",
          anchor,
          refs,
        });
      });
    }

    if (threadRail) threadRail.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      const card = event.target.closest("[data-thread-id]");

      if (!button && card) {
        const threadId = card.dataset.threadId;
        activateThread(threadId, refs, true);
        return;
      }

      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const threadId = button.dataset.threadId;
      const messageId = button.dataset.messageId;
      if (!action || !threadId) {
        return;
      }
      await handleThreadAction(action, threadId, messageId, refs, isPublic);
    });


    loadNote().catch((error) => {
      console.error(error);
      refs.previewContent.innerHTML = `<p>${escapeHtml(error.message || "Failed to load note.")}</p>`;
    });

    async function loadNote() {
      if (!isPublic) {
        // Load note metadata (shareAccess, threads, etc.) via REST
        const payload = await api(`/api/notes/${noteId}`);
        applyNotePayload(payload, refs, false);
        return;
      }

      const endpoint = `/api/share/${shareId}`;
      const payload = await api(endpoint);
      applyNotePayload(payload, refs, isPublic);

      if (isPublicEdit) {
        if (!payload.viewer.isOwner && !payload.viewer.commenterName) {
          await openIdentityModalAsync(refs);
        }
        initCollabEditor();
      } else {
        if (shareAccess === "comment" && !payload.viewer.isOwner && !payload.viewer.commenterName) {
          openIdentityModal(refs, true);
        }
        connectWebSocket(refs, isPublic);
      }
    }

    function connectWebSocket(refsArg, publicMode) {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const param = publicMode ? `shareId=${encodeURIComponent(shareId)}` : `noteId=${encodeURIComponent(noteId)}`;
      const wsUrl = `${protocol}//${location.host}/?${param}`;
      let reconnectDelay = 1000;
      let ws;

      function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { reconnectDelay = 1000; };
        ws.onmessage = (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.type === "threads-updated") {
            reloadThreads(publicMode);
            return;
          }
          if (msg.type !== "updated") {
            return;
          }
          if (!state.note || msg.updatedAt === state.note.updatedAt) {
            return;
          }
          reloadFromServer(refsArg, publicMode);
        };
        ws.onclose = () => {
          setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
            connect();
          }, reconnectDelay);
        };
      }

      connect();
    }

    async function reloadFromServer(refsArg, publicMode) {
      const endpoint = publicMode ? `/api/share/${shareId}` : `/api/notes/${noteId}`;
      const payload = await api(endpoint);

      if (!publicMode && state.saveStatus === "Saving") {
        return;
      }

      state.note.updatedAt = payload.note.updatedAt;
      state.threads = payload.threads;
      state.viewer = payload.viewer;

      if (publicMode) {
        state.note.markdown = payload.note.markdown;
        if (refsArg.previewContent) {
          refsArg.previewContent.innerHTML = payload.note.renderedHtml || "";
        }
        if (refsArg.topbarTitle) {
          refsArg.topbarTitle.textContent = payload.note.title || "untitled";
        }
      } else {
        if (state.saveStatus !== "Saving") {
          state.note.markdown = payload.note.markdown;
          state.note.title = payload.note.title;
          if (refsArg.editorTextarea && refsArg.editorTextarea.value !== payload.note.markdown) {
            const scrollTop = refsArg.editorTextarea.scrollTop;
            const selStart = refsArg.editorTextarea.selectionStart;
            const selEnd = refsArg.editorTextarea.selectionEnd;
            refsArg.editorTextarea.value = payload.note.markdown;
            refsArg.editorTextarea.scrollTop = scrollTop;
            refsArg.editorTextarea.setSelectionRange(selStart, selEnd);
          }
          if (refsArg.titleInput && refsArg.titleInput.value !== payload.note.title) {
            refsArg.titleInput.value = payload.note.title;
          }
          if (refsArg.previewContent) {
            refsArg.previewContent.innerHTML = payload.note.renderedHtml || "";
          }
        }
      }

      if (refsArg.commenterLabel) {
        refsArg.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
      }
      syncThreadLayout(refsArg);
    }

    async function reloadThreads(publicMode) {
      if (!state.note) return;
      try {
        const endpoint = publicMode ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
        const payload = await api(endpoint);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName ? payload.viewer.commenterName : "anonymous";
        }
        syncThreadLayout(refs);
        refreshOpenThreadDialog(refs, publicMode);
      } catch (e) {
        console.error("Failed to reload threads:", e);
      }
    }

    function applyNotePayload(payload, refsArg, publicMode) {
      state.note = payload.note;
      state.viewer = payload.viewer;
      state.threads = payload.threads;

      if (refsArg.topbarTitle) {
        refsArg.topbarTitle.textContent = payload.note.title || "untitled";
      }
      if (refsArg.titleInput) {
        refsArg.titleInput.value = payload.note.title || "untitled";
      }
      if (refsArg.editorTextarea) {
        refsArg.editorTextarea.value = payload.note.markdown || "";
      }
      if (refsArg.previewContent) {
        refsArg.previewContent.innerHTML = payload.note.renderedHtml || "";
      }
      if (refsArg.commenterLabel) {
        refsArg.commenterLabel.textContent = payload.viewer.commenterName ? payload.viewer.commenterName : "anonymous";
      }
      if (refsArg.saveStatus) {
        refsArg.saveStatus.textContent = publicMode ? "" : "Saved";
      }
      updateResolvedButton(refsArg.resolvedButton);
      updateCommentsButton(refsArg.commentsButton);
      syncThreadLayout(refsArg);
    }

    function scheduleRender(refsArg) {
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(async () => {
        const endpoint = isPublic ? `/api/share/${shareId}/render` : "/api/render";
        const payload = await api(endpoint, {
          method: "POST",
          body: { markdown: state.note?.markdown || "" },
        });
        if (refsArg.previewContent) {
          refsArg.previewContent.innerHTML = payload.html;
        }
        syncThreadLayout(refsArg);
      }, 150);
    }
  }

  function renderEditorLayout() {
    return `
      <div class="app-root">
        <header class="topbar">
          <div class="topbar-left">
            <button type="button" class="icon-button ghost" id="notesButton" aria-label="Back to notes">&lsaquo;</button>
            <input id="titleInput" class="title-input" type="text" spellcheck="false" value="untitled" />
            <span class="status-text" id="saveStatus"></span>
          </div>
          <div class="topbar-right">
            <button type="button" class="icon-button ghost" id="previewFab" aria-label="Preview" title="Preview"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>
            <div class="share-popover-wrap" id="sharePopoverWrap">
              <button type="button" class="icon-button ghost" id="shareButton" aria-label="Share" title="Share"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="12" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 7.1l4.4-2.2M5.8 8.9l4.4 2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>
              <div class="share-popover hidden" id="sharePopover"></div>
            </div>
            <button type="button" class="icon-button ghost" id="logoutButton" aria-label="Logout" title="Logout"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 11.5L14 8l-3.5-3.5M6 8h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button type="button" class="text-button theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="workspace">
          <section class="editor-pane">
            <div id="disconnectedBanner" class="editor-disconnected hidden">Disconnected. Reconnecting...</div>
            <textarea id="editorTextarea" class="editor-textarea" spellcheck="false"></textarea>
          </section>
          <section class="preview-stage" id="previewStage">
            <button type="button" class="preview-close-button" id="previewCloseButton" aria-label="Close preview">&times;</button>
            <div class="preview-controls" id="previewControls">
              <button type="button" class="preview-control-button" id="commentsButton">hide comments</button>
              <button type="button" class="preview-control-button" id="resolvedButton">resolved</button>
            </div>
            <div class="preview-scroll" id="previewScroll">
              <div class="preview-canvas" id="previewCanvas">
                <div class="preview-content markdown-body" id="previewContent"></div>
                <div class="highlight-layer" id="highlightLayer"></div>
                <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
                <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
                <aside class="thread-rail" id="threadRail"></aside>
              </div>
            </div>
          </section>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function renderPublicLayout(viewOnly) {
    const commentControls = viewOnly ? "" : `
            <button type="button" class="preview-control-button" id="commentsButton">hide comments</button>
            <button type="button" class="preview-control-button" id="resolvedButton">resolved</button>`;
    const commentElements = viewOnly ? "" : `
              <div class="highlight-layer" id="highlightLayer"></div>
              <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
              <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
              <aside class="thread-rail" id="threadRail"></aside>`;
    const subtitle = viewOnly ? "" : `<div class="topbar-title-subtle">comments as <span id="commenterLabel">anonymous</span></div>`;
    return `
      <div class="app-root">
        <header class="topbar public-page-topbar">
          <div class="topbar-left">
            <div>
              <div class="topbar-title" id="topbarTitle">note</div>
              ${subtitle}
            </div>
          </div>
          <div class="topbar-right">
            <button type="button" class="text-button theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="preview-stage public" id="previewStage">
          <div class="preview-controls" id="previewControls">
            ${commentControls}
          </div>
          <div class="preview-scroll" id="previewScroll">
            <div class="preview-canvas" id="previewCanvas">
              <div class="preview-content markdown-body" id="previewContent"></div>
              ${commentElements}
            </div>
          </div>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function renderPublicEditorLayout() {
    return `
      <div class="app-root">
        <header class="topbar public-page-topbar">
          <div class="topbar-left">
            <div>
              <div class="topbar-title" id="topbarTitle">note</div>
              <div class="topbar-title-subtle">editing as <span id="commenterLabel">anonymous</span></div>
            </div>
            <span class="status-text" id="saveStatus"></span>
          </div>
          <div class="topbar-right">
            <button type="button" class="icon-button ghost" id="previewFab" aria-label="Preview" title="Preview"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>
            <button type="button" class="text-button theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="workspace">
          <section class="editor-pane">
            <div id="disconnectedBanner" class="editor-disconnected hidden">Disconnected. Reconnecting...</div>
            <textarea id="editorTextarea" class="editor-textarea" spellcheck="false"></textarea>
          </section>
          <section class="preview-stage" id="previewStage">
            <button type="button" class="preview-close-button" id="previewCloseButton" aria-label="Close preview">&times;</button>
            <div class="preview-controls" id="previewControls">
              <button type="button" class="preview-control-button" id="commentsButton">hide comments</button>
              <button type="button" class="preview-control-button" id="resolvedButton">resolved</button>
            </div>
            <div class="preview-scroll" id="previewScroll">
              <div class="preview-canvas" id="previewCanvas">
                <div class="preview-content markdown-body" id="previewContent"></div>
                <div class="highlight-layer" id="highlightLayer"></div>
                <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
                <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
                <aside class="thread-rail" id="threadRail"></aside>
              </div>
            </div>
          </section>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function setSaveStatus(refs, value) {
    state.saveStatus = value;
    if (refs.saveStatus) {
      refs.saveStatus.textContent = value;
      refs.saveStatus.classList.remove("status-fade");
      if (value === "Saved") {
        clearTimeout(state.statusFadeTimer);
        state.statusFadeTimer = setTimeout(() => {
          refs.saveStatus.classList.add("status-fade");
        }, 1500);
      }
    }
  }

  function toggleSharePopover(refs) {
    const popover = document.getElementById("sharePopover");
    if (!popover) return;
    if (!popover.classList.contains("hidden")) { popover.classList.add("hidden"); return; }
    const access = state.note?.shareAccess || "none";
    const shareUrl = `${location.origin}/s/${state.note?.shareId || ""}`;
    popover.innerHTML = `
      <div class="share-popover-row">
        <select id="shareAccessSelect">
          <option value="none" ${access === "none" ? "selected" : ""}>Not shared</option>
          <option value="view" ${access === "view" ? "selected" : ""}>View only</option>
          <option value="comment" ${access === "comment" ? "selected" : ""}>View & comment</option>
          <option value="edit" ${access === "edit" ? "selected" : ""}>Edit & comment</option>
        </select>
        <button type="button" id="shareCopyBtn" class="${access === "none" ? "share-copy-disabled" : ""}" ${access === "none" ? "disabled" : ""}>copy link</button>
      </div>
    `;
    popover.classList.remove("hidden");
    const select = popover.querySelector("#shareAccessSelect");
    const copyBtn = popover.querySelector("#shareCopyBtn");
    select.addEventListener("change", async () => {
      if (!state.note) return;
      const val = select.value;
      state.note.shareAccess = val;
      await api(`/api/notes/${state.note.id}`, { method: "PUT", body: { shareAccess: val } });
      if (val === "none") {
        copyBtn.disabled = true; copyBtn.classList.add("share-copy-disabled");
      } else {
        copyBtn.disabled = false; copyBtn.classList.remove("share-copy-disabled");
      }
    });
    copyBtn.addEventListener("click", async () => {
      if (select.value === "none") return;
      try { await navigator.clipboard.writeText(shareUrl); copyBtn.textContent = "copied!"; setTimeout(() => { copyBtn.textContent = "copy link"; }, 1500); } catch {}
    });
    const closeHandler = (e) => { if (!popover.contains(e.target) && e.target.id !== "shareButton") { popover.classList.add("hidden"); document.removeEventListener("click", closeHandler); } };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  }

  function openIdentityModalAsync(refs) {
    return new Promise((resolve) => {
      openIdentityModal(refs, false, resolve);
    });
  }

  function updateResolvedButton(button) {
    if (!button) {
      return;
    }
    button.textContent = state.showResolved ? "hide resolved" : "resolved";
  }

  function updateCommentsButton(button) {
    if (!button) {
      return;
    }
    button.textContent = state.showComments ? "hide comments" : "comments";
  }

  function scheduleLayout(refs) {
    cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = requestAnimationFrame(() => syncThreadLayout(refs));
  }

  function syncThreadLayout(refs) {
    if (!refs.previewContent || !refs.threadRail || !refs.highlightLayer) {
      return;
    }

    state.visibleMatches.clear();
    refs.highlightLayer.innerHTML = "";
    refs.threadRail.innerHTML = "";

    if (!state.note) {
      return;
    }

    if (!state.showComments) {
      return;
    }

    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    const visible = [];

    for (const thread of state.threads) {
      if (thread.resolved && !state.showResolved) {
        continue;
      }
      const match = locateAnchor(thread.anchor, refs.previewContent);
      if (!match) {
        continue;
      }
      const rects = Array.from(match.range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) {
        continue;
      }

      const merged = mergeRects(rects, canvasRect);
      for (const rect of merged) {
        const highlight = document.createElement("button");
        highlight.type = "button";
        highlight.className = `anchor-highlight${thread.id === state.activeThreadId ? " active" : ""}`;
        highlight.dataset.threadId = thread.id;
        highlight.setAttribute("aria-label", "Open comment thread");
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        refs.highlightLayer.appendChild(highlight);
      }

      const top = rects[0].top - canvasRect.top;
      visible.push({ thread, top, match });
      state.visibleMatches.set(thread.id, match);
    }

    if (!visible.length) {
      refs.threadRail.innerHTML = "";
      return;
    }

    visible.sort((a, b) => {
      const startDelta = (a.thread.anchor?.start || 0) - (b.thread.anchor?.start || 0);
      if (startDelta !== 0) {
        return startDelta;
      }
      return a.top - b.top;
    });

    const cards = visible.map((item) => {
      const card = document.createElement("section");
      card.className = `thread-card${item.thread.id === state.activeThreadId ? " active" : ""}${item.thread.resolved ? " resolved" : ""}`;
      card.dataset.threadId = item.thread.id;
      card.style.top = `${item.top}px`;
      card.innerHTML = renderThreadCard(item.thread);
      refs.threadRail.appendChild(card);
      return { card, desiredTop: item.top };
    });

    let cursor = 14;
    for (const item of cards) {
      const top = Math.max(cursor, item.desiredTop);
      item.card.style.top = `${top}px`;
      cursor = top + item.card.offsetHeight + 12;
    }
  }

  function renderThreadCard(thread) {
    const tree = buildMessageTree(thread.messages);
    if (!tree.length) {
      return "";
    }

    const flat = flattenTree(tree);

    return `
      <div class="thread-tree">
        ${flat.map((item) => renderFlatMessage(thread, item.message, item.depth)).join("")}
      </div>
      ${(thread.canResolve || thread.canDeleteThread) ? `<div class="thread-footer">
        ${thread.canResolve ? `<button type="button" class="text-button thread-footer-button" data-action="${thread.resolved ? "reopen" : "resolve"}" data-thread-id="${escapeHtml(thread.id)}">${thread.resolved ? "reopen" : "resolve"}</button>` : ""}
        ${thread.canDeleteThread ? `<button type="button" class="text-button danger thread-footer-button" data-action="delete-thread" data-thread-id="${escapeHtml(thread.id)}">delete</button>` : ""}
      </div>` : ""}
    `;
  }

  function flattenTree(roots) {
    const result = [];
    // justBranched: true if the parent was a branch point (had multiple children)
    // This causes the first generation after a branch to indent +1 for visual grouping
    function walk(nodes, indent, justBranched) {
      for (const node of nodes) {
        result.push({ message: node.message, depth: indent });
        const multipleChildren = node.children.length > 1;
        let childIndent;
        if (multipleChildren) {
          childIndent = indent + 1;
        } else if (justBranched && indent > 0) {
          childIndent = indent + 1;
        } else {
          childIndent = indent;
        }
        walk(node.children, childIndent, multipleChildren);
      }
    }
    const multipleRoots = roots.length > 1;
    walk(roots, multipleRoots ? 1 : 0, multipleRoots);
    return result;
  }

  function renderFlatMessage(thread, message, depth) {
    const canReply = thread.canReply && !thread.resolved;
    const isFirst = thread.messages[0]?.id === message.id;
    const indented = depth > 0;

    return `
      <div class="thread-node" style="--depth:${depth}">
        <div class="thread-message${indented ? " thread-message-reply" : " thread-message-root"}">
          <div class="thread-message-head">
            <span class="thread-author${isFirst ? "" : " thread-author-small"}">${escapeHtml(message.authorName)}</span>
            <span class="thread-meta">${escapeHtml(formatRelativeTime(message.updatedAt))}</span>
            <span class="thread-message-actions">
              ${canReply ? renderIconButton("reply", thread.id, message.id, "Reply") : ""}
              ${message.canEdit ? renderIconButton("edit-message", thread.id, message.id, "Edit") : ""}
              ${message.canDelete ? renderIconButton("delete-message", thread.id, message.id, "Delete", true) : ""}
            </span>
          </div>
          <div class="thread-body${isFirst ? "" : " thread-body-small"}">${escapeHtml(message.body)}</div>
        </div>
      </div>
    `;
  }

  function buildMessageTree(messages) {
    const nodes = new Map(messages.map((message) => [message.id, { message, children: [] }]));
    const roots = [];

    for (const node of nodes.values()) {
      const parentId = node.message.parentId;
      if (parentId && nodes.has(parentId)) {
        nodes.get(parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (items) => {
      items.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
      for (const item of items) {
        sortNodes(item.children);
      }
      return items;
    };

    return sortNodes(roots);
  }

  function renderIconButton(action, threadId, messageId, label, danger = false) {
    return `<button type="button" class="icon-action${danger ? " danger" : ""}" data-action="${escapeHtml(action)}" data-thread-id="${escapeHtml(threadId)}"${messageId ? ` data-message-id="${escapeHtml(messageId)}"` : ""} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${iconSvg(action)}</button>`;
  }

  function iconSvg(action) {
    if (action === "reply") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 4.2 2.5 8l3.7 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 8h5.5c2.7 0 4.5 1.2 4.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (action === "edit-message") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11.8 3.6 9l5.9-5.9 2.4 2.4L6 11.4 3 11.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m8.8 3.8 2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    }
    if (action === "delete-message" || action === "delete-thread") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.2 4.5V3.4c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9v1.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="m5 6.2.5 6.1c0 .4.4.7.8.7h3.4c.4 0 .8-.3.8-.7l.5-6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (action === "resolve") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 2.6 2.6 6.4-6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (action === "reopen") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 6.1V3.3M4.1 3.3H6.9M4.1 3.3 7 6.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8a4.9 4.9 0 1 1-1.3-3.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    return '';
  }

  function activateThread(threadId, refs, scrollIntoView) {
    state.activeThreadId = threadId;
    syncThreadLayout(refs);
    if (!scrollIntoView) {
      return;
    }
    const match = state.visibleMatches.get(threadId);
    if (!match) {
      return;
    }
    const rects = Array.from(match.range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) {
      return;
    }
    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    const targetTop = rects[0].top - canvasRect.top - 80;
    refs.previewScroll.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }

  function updateSelectionBubble(refs) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    const range = selection.getRangeAt(0);
    if (!refs.previewContent.contains(range.commonAncestorContainer)) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    const anchor = buildAnchorFromSelection(refs.previewContent, range);
    if (!anchor || !anchor.quote.trim()) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    state.pendingAnchor = anchor;

    if (isMobileDevice) {
      refs.selectionBubble.classList.add("hidden");
      return;
    }

    const rect = range.getBoundingClientRect();
    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    refs.selectionBubble.style.left = `${Math.max(16, rect.left - canvasRect.left)}px`;
    refs.selectionBubble.style.top = `${rect.bottom - canvasRect.top + 6}px`;
    refs.selectionBubble.classList.remove("hidden");
  }

  function openIdentityModal(refs, mandatory, onDone) {
    openModal(refs, {
      title: "",
      description: "",
      submitLabel: "Continue",
      cancelLabel: mandatory ? null : "Cancel",
      compact: true,
      fields: [
        {
          name: "name",
          label: "",
          type: "text",
          value: state.viewer?.commenterName || "",
          placeholder: "Your name",
        },
      ],
      onSubmit: async (values) => {
        await api(`/api/share/${state.note.shareId}/identity`, {
          method: "POST",
          body: { name: values.name || "" },
        });
        const payload = await api(`/api/share/${state.note.shareId}`);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
        }
        syncThreadLayout(refs);
        if (onDone) onDone();
      },
    });
  }

  function openComposerModal(options) {
    const refs = options.refs;

    if (!state.viewer?.isOwner && !state.viewer?.commenterName) {
      openIdentityModal(refs, true);
      return;
    }

    const isEdit = options.mode === "edit";
    const isReply = options.mode === "reply";
    const reopenThreadId = (window.innerWidth <= 980) ? options.threadId : null;
    const onCancel = reopenThreadId ? () => {
      const stillExists = state.threads.find((item) => item.id === reopenThreadId);
      if (stillExists) {
        setTimeout(() => openThreadDialog(reopenThreadId, refs, state.page === "public"), 50);
      }
    } : null;

    openModal(refs, {
      title: isEdit ? "Edit comment" : isReply ? "Reply" : "New comment",
      description: isReply ? "Add a reply to this thread." : "Comment on the selected text.",
      submitLabel: isEdit ? "Save" : isReply ? "Reply" : "Comment",
      cancelLabel: "Cancel",
      compact: true,
      onCancel,
      fields: [
        ...(state.viewer?.isOwner || state.viewer?.commenterName
          ? []
          : [
              {
                name: "name",
                label: "Name",
                type: "text",
                value: "",
                placeholder: "Your name",
              },
            ]),
        {
          name: "body",
          label: "Comment",
          type: "textarea",
          value: options.initialBody || "",
          placeholder: "Write a comment",
        },
      ],
      onSubmit: async (values) => {
        if (!state.viewer?.isOwner && !state.viewer?.commenterName && values.name) {
          await api(`/api/share/${state.note.shareId}/identity`, {
            method: "POST",
            body: { name: values.name },
          });
        }

        if (options.mode === "thread") {
          await api(`/api/share/${state.note.shareId}/threads`, {
            method: "POST",
            body: { anchor: options.anchor, body: values.body },
          });
        }

        if (options.mode === "reply") {
          await api(`/api/share/${state.note.shareId}/threads/${options.threadId}/replies`, {
            method: "POST",
            body: { body: values.body, parentMessageId: options.parentMessageId || null },
          });
        }

        if (options.mode === "edit") {
          await api(`/api/share/${state.note.shareId}/messages/${options.messageId}`, {
            method: "PATCH",
            body: { body: values.body },
          });
        }

        const endpoint = state.page === "public" ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
        const payload = await api(endpoint);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
        }
        state.pendingAnchor = null;
        refs.selectionBubble.classList.add("hidden");
        updateCommentFab(refs);
        syncThreadLayout(refs);
        if (reopenThreadId) {
          const stillExists = state.threads.find((item) => item.id === reopenThreadId);
          if (stillExists) {
            setTimeout(() => openThreadDialog(reopenThreadId, refs, state.page === "public"), 50);
          }
        }
      },
    });
  }

  function openModal(refs, options) {
    state.modalOpen = true;
    refs.modalBackdrop.classList.remove("hidden");
    refs.modalBackdrop.innerHTML = `
      <div class="modal${options.compact ? " compact" : ""}" role="dialog" aria-modal="true">
        ${options.compact ? "" : `<h2>${escapeHtml(options.title)}</h2>`}
        ${options.compact ? "" : options.description ? `<p>${escapeHtml(options.description)}</p>` : ""}
        <form id="modalForm">
          ${options.fields
            .map((field) => `
              <div class="field">
                ${options.compact ? "" : `<label>${escapeHtml(field.label)}</label>`}
                ${
                  field.type === "textarea"
                    ? `<textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(field.value || "")}</textarea>`
                    : `<input type="${escapeHtml(field.type)}" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" />`
                }
              </div>
            `)
            .join("")}
          <div class="inline-error hidden" id="modalError"></div>
          <div class="modal-actions">
            ${options.cancelLabel ? `<button type="button" class="ghost" id="modalCancel">${escapeHtml(options.cancelLabel)}</button>` : ""}
            <button type="submit" class="primary">${escapeHtml(options.submitLabel)}</button>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById("modalForm");
    const cancelButton = document.getElementById("modalCancel");
    const errorNode = document.getElementById("modalError");

    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        closeModal(refs);
        if (options.onCancel) {
          options.onCancel();
        }
      });
    }

    const firstInput = form.querySelector("textarea, input");
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 50);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());
      errorNode.classList.add("hidden");
      errorNode.textContent = "";
      try {
        await options.onSubmit(values);
        closeModal(refs);
      } catch (error) {
        errorNode.textContent = error.message || "Request failed.";
        errorNode.classList.remove("hidden");
      }
    });
  }

  function closeModal(refs) {
    state.modalOpen = false;
    refs.modalBackdrop.classList.add("hidden");
    refs.modalBackdrop.innerHTML = "";
  }

  async function handleThreadAction(action, threadId, messageId, refs, isPublic) {
    if (action === "reply") {
      openComposerModal({ mode: "reply", threadId, parentMessageId: messageId, refs });
      return { kind: "opened-modal" };
    }

    if (action === "resolve" || action === "reopen") {
      await api(`/api/share/${state.note.shareId}/threads/${threadId}`, {
        method: "PATCH",
        body: { resolved: action === "resolve" },
      });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    if (action === "delete-thread") {
      if (!window.confirm("Delete this thread?")) {
        return { kind: "cancelled" };
      }
      await api(`/api/share/${state.note.shareId}/threads/${threadId}`, { method: "DELETE" });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    if (action === "edit-message" && messageId) {
      const thread = state.threads.find((item) => item.id === threadId);
      const message = thread?.messages.find((item) => item.id === messageId);
      if (!message) {
        return { kind: "cancelled" };
      }
      openComposerModal({ mode: "edit", threadId, messageId, initialBody: message.body, refs });
      return { kind: "opened-modal" };
    }

    if (action === "delete-message" && messageId) {
      if (!window.confirm("Delete this comment?")) {
        return { kind: "cancelled" };
      }
      await api(`/api/share/${state.note.shareId}/messages/${messageId}`, { method: "DELETE" });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    return { kind: "cancelled" };
  }

  async function reloadThreadState(refs, isPublic) {
    const endpoint = isPublic ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
    const payload = await api(endpoint);
    state.viewer = payload.viewer;
    state.threads = payload.threads;
    if (refs.commenterLabel) {
      refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
    }
    syncThreadLayout(refs);
  }

  function refreshOpenThreadDialog(refs, isPublic) {
    if (!state.modalOpen || !state.activeThreadId) return;
    const body = refs.modalBackdrop?.querySelector(".thread-modal-body");
    if (!body) return;
    const thread = state.threads.find((item) => item.id === state.activeThreadId);
    if (!thread) {
      closeModal(refs);
      state.activeThreadId = null;
      return;
    }
    body.innerHTML = renderThreadCard(thread);
  }

  function openThreadDialog(threadId, refs, isPublic) {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      return;
    }

    state.activeThreadId = threadId;
    syncThreadLayout(refs);

    state.modalOpen = true;
    refs.modalBackdrop.classList.remove("hidden");
    refs.modalBackdrop.innerHTML = `
      <div class="modal thread-modal" role="dialog" aria-modal="true">
        <button type="button" class="thread-modal-close" id="threadDialogClose" aria-label="Close">×</button>
        <div class="thread-modal-body">${renderThreadCard(thread)}</div>
      </div>
    `;

    const closeThreadDialog = () => {
      state.activeThreadId = null;
      closeModal(refs);
      syncThreadLayout(refs);
    };

    refs.modalBackdrop.querySelector("#threadDialogClose").addEventListener("click", closeThreadDialog);
    refs.modalBackdrop.addEventListener("click", (event) => {
      if (event.target === refs.modalBackdrop) {
        closeThreadDialog();
      }
    });
    refs.modalBackdrop.querySelector(".thread-modal-body").addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }
      const action = button.dataset.action;
      const actionThreadId = button.dataset.threadId;
      const actionMessageId = button.dataset.messageId;
      if (!action || !actionThreadId) {
        return;
      }
      const result = await handleThreadAction(action, actionThreadId, actionMessageId, refs, isPublic);
      if (result && result.kind === "opened-modal") {
        return;
      }
      const refreshed = state.threads.find((item) => item.id === threadId);
      if (!refreshed) {
        closeModal(refs);
        return;
      }
      openThreadDialog(threadId, refs, isPublic);
    });
  }

  function mergeRects(rects, canvasRect) {
    const items = Array.from(rects)
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        left: r.left - canvasRect.left,
        top: r.top - canvasRect.top,
        width: r.width,
        height: r.height,
      }))
      .sort((a, b) => a.top - b.top || a.left - b.left);

    if (!items.length) {
      return [];
    }

    const merged = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = items[i];
      const prevBottom = prev.top + prev.height;
      const currBottom = curr.top + curr.height;
      const verticalOverlap = Math.abs(prev.top - curr.top) < prev.height * 0.5;

      if (verticalOverlap) {
        const newLeft = Math.min(prev.left, curr.left);
        const newRight = Math.max(prev.left + prev.width, curr.left + curr.width);
        const newTop = Math.min(prev.top, curr.top);
        const newBottom = Math.max(prevBottom, currBottom);
        prev.left = newLeft;
        prev.top = newTop;
        prev.width = newRight - newLeft;
        prev.height = newBottom - newTop;
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }

  function findAnchorAtPoint(x, y, layer) {
    const anchors = layer.querySelectorAll(".anchor-highlight");
    for (const anchor of anchors) {
      const rect = anchor.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return anchor.dataset.threadId || null;
      }
    }
    return null;
  }

  function updateCommentFab(refs) {
    if (!refs.commentFab) {
      return;
    }
    const bubbleVisible = refs.selectionBubble && refs.selectionBubble.offsetParent !== null;
    if (!bubbleVisible && state.pendingAnchor && state.pendingAnchor.quote.trim()) {
      refs.commentFab.style.display = "flex";
      const isMobile = isMobileDevice;
      if (isMobile) {
        refs.commentFab.style.position = "fixed";
        refs.commentFab.style.bottom = "1.25rem";
        refs.commentFab.style.right = "1.25rem";
        refs.commentFab.style.left = "";
        refs.commentFab.style.top = "";
      } else {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const canvasRect = refs.previewCanvas.getBoundingClientRect();
          refs.commentFab.style.position = "absolute";
          refs.commentFab.style.left = `${Math.max(16, rect.left - canvasRect.left)}px`;
          refs.commentFab.style.top = `${rect.bottom - canvasRect.top + 6}px`;
          refs.commentFab.style.bottom = "";
          refs.commentFab.style.right = "";
        }
      }
    } else {
      refs.commentFab.style.display = "none";
    }
  }

  function buildAnchorFromSelection(root, range) {
    const mapping = collectTextNodes(root);
    const start = resolveOffset(root, mapping, range.startContainer, range.startOffset);
    const end = resolveOffset(root, mapping, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) {
      return null;
    }
    const quote = mapping.fullText.slice(start, end);
    if (!quote.trim()) {
      return null;
    }
    return {
      quote,
      prefix: mapping.fullText.slice(Math.max(0, start - 40), start),
      suffix: mapping.fullText.slice(end, Math.min(mapping.fullText.length, end + 40)),
      start,
      end,
    };
  }

  function locateAnchor(anchor, root) {
    const mapping = collectTextNodes(root);
    if (!mapping.fullText || !anchor.quote) {
      return null;
    }

    const candidates = [];
    const exactSlice = mapping.fullText.slice(anchor.start, anchor.end);
    if (exactSlice === anchor.quote) {
      candidates.push(anchor.start);
    }

    let index = mapping.fullText.indexOf(anchor.quote);
    while (index !== -1) {
      if (!candidates.includes(index)) {
        candidates.push(index);
      }
      index = mapping.fullText.indexOf(anchor.quote, index + Math.max(1, anchor.quote.length));
    }

    if (!candidates.length) {
      return null;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      let score = 0;
      if (mapping.fullText.slice(Math.max(0, candidate - anchor.prefix.length), candidate) === anchor.prefix) {
        score += 12;
      }
      const suffix = mapping.fullText.slice(candidate + anchor.quote.length, candidate + anchor.quote.length + anchor.suffix.length);
      if (suffix === anchor.suffix) {
        score += 12;
      }
      score -= Math.abs(candidate - anchor.start) / 8;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best == null) {
      return null;
    }

    const range = offsetsToRange(mapping, best, best + anchor.quote.length);
    if (!range) {
      return null;
    }

    return { range, start: best, end: best + anchor.quote.length };
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    let node;
    let offset = 0;
    let fullText = "";

    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      segments.push({ node, start: offset, end: offset + value.length });
      fullText += value;
      offset += value.length;
    }

    return { fullText, segments };
  }

  function resolveOffset(root, mapping, container, localOffset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const segment = mapping.segments.find((item) => item.node === container);
      return segment ? segment.start + localOffset : null;
    }

    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container, localOffset);
    return range.toString().length;
  }

  function offsetsToRange(mapping, start, end) {
    const startSegment = mapping.segments.find((segment) => start >= segment.start && start <= segment.end);
    const endSegment = mapping.segments.find((segment) => end >= segment.start && end <= segment.end);
    if (!startSegment || !endSegment) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    return range;
  }

  async function logoutOwner() {
    await api("/api/auth/logout", { method: "POST" });
    window.localStorage.removeItem(ownerTokenKey);
    window.location.href = "/login";
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMessage = typeof payload === "string" ? payload : payload.error || "Request failed.";
      throw new Error(errorMessage);
    }

    return payload;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function formatRelativeTime(value) {
    const delta = Math.max(0, Date.now() - new Date(value).getTime());
    const second = 1000;
    const minute = second * 60;
    const hour = minute * 60;
    const day = hour * 24;

    if (delta < minute) {
      return `${Math.max(1, Math.floor(delta / second))}s`;
    }
    if (delta < hour) {
      return `${Math.floor(delta / minute)}m`;
    }
    if (delta < day) {
      return `${Math.floor(delta / hour)}h`;
    }
    return `${Math.floor(delta / day)}d`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
