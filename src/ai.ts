import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CopilotClient, defineTool, type CopilotSession, type ToolResultObject } from "@github/copilot-sdk";

export const AI_PARTICIPANT = {
  id: "jot-ai",
  name: "Jot AI",
  kind: "ai",
} as const;

const AI_STATE_VERSION = 1;
const PROPOSAL_TOOL_NAME = "submit_note_proposal";
const DEFAULT_MODEL = process.env.JOT_AI_MODEL || "gpt-5";

export type ProposalAnchor = {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};

export type AiActor = {
  id: string;
  name: string;
  kind: "owner" | "editor" | "ai";
};

export type AiTurn = {
  id: string;
  role: "user" | "assistant";
  status: "completed" | "in_progress" | "failed" | "cancelled";
  author: AiActor;
  createdAt: string;
  updatedAt: string;
  content: string;
  error?: string;
  proposalIds: string[];
  inReplyToTurnId?: string;
};

export type ProposalHunkDisplay = {
  state: "resolved" | "stale" | "ambiguous" | "not-inline-renderable";
  reason?: string;
  renderedStart?: number;
  renderedEnd?: number;
};

export type AiProposalHunk = {
  id: string;
  oldText: string;
  newText: string;
  anchor: ProposalAnchor;
  display?: ProposalHunkDisplay;
};

export type AiProposal = {
  id: string;
  summary: string;
  status: "open" | "accepted" | "rejected" | "stale";
  sourceTurnId: string;
  createdAt: string;
  updatedAt: string;
  baseServerCounter: number;
  hunks: AiProposalHunk[];
  acceptedBy?: AiActor;
  acceptedAt?: string;
  rejectedBy?: AiActor;
  rejectedAt?: string;
  staleReason?: string;
};

export type AiToolActivity = {
  id: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  resultSummary?: string;
  error?: string;
};

export type AiActiveRun = {
  id: string;
  promptTurnId: string;
  assistantTurnId: string;
  status: "running" | "cancelling";
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  content: string;
  toolActivities: AiToolActivity[];
};

type AiStateFile = {
  version: number;
  noteId: string;
  createdAt: string;
  updatedAt: string;
  turns: AiTurn[];
  proposals: AiProposal[];
  activeRun: AiActiveRun | null;
};

export type AiPermissions = {
  canPrompt: boolean;
  canCancel: boolean;
  canReset: boolean;
  canManageProposals: boolean;
  canViewLive: boolean;
};

export type SerializedAiState = {
  identity: typeof AI_PARTICIPANT;
  turns: AiTurn[];
  proposals: AiProposal[];
  activeRun: AiActiveRun | null;
  queueDepth: number;
  permissions: AiPermissions;
};

export type AiNoteContext = {
  id: string;
  title: string;
  markdown: string;
  serverCounter: number;
};

export type EnqueuePromptResult = {
  runId: string;
  state: SerializedAiState;
};

export type AiDeltaEvent = {
  noteId: string;
  runId: string;
  assistantTurnId: string;
  delta: string;
  content: string;
};

export type AiToolEvent = {
  noteId: string;
  runId: string;
  activity: AiToolActivity;
};

export type ProposalReplacement = {
  hunkId: string;
  start: number;
  end: number;
  oldText: string;
  newText: string;
};

export type PrepareProposalAcceptanceResult =
  | {
      ok: true;
      replacements: ProposalReplacement[];
      proposal: AiProposal;
      state: SerializedAiState;
    }
  | {
      ok: false;
      error: string;
      state: SerializedAiState;
    };

type PromptToolArgs = {
  summary?: unknown;
  hunks?: unknown;
};

type PromptToolHunk = {
  oldText: string;
  newText: string;
};

type AiCallbacks = {
  onStateUpdated: (noteId: string) => void;
  onMessageDelta: (event: AiDeltaEvent) => void;
  onToolActivity: (event: AiToolEvent) => void;
  renderMarkdownToText: (markdown: string) => string;
};

type LiveRun = {
  session: CopilotSession;
  cancelRequested: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function createId(length = 12) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function clampText(input: string, limit: number) {
  return input.length > limit ? `${input.slice(0, limit)}…` : input;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stringifyToolResult(result: unknown) {
  if (result == null) {
    return "";
  }
  if (typeof result === "string") {
    return clampText(result, 240);
  }
  try {
    return clampText(JSON.stringify(result), 240);
  } catch {
    return clampText(String(result), 240);
  }
}

function buildProposalAnchor(markdown: string, oldText: string): ProposalAnchor | null {
  if (!oldText) {
    return null;
  }

  const firstIndex = markdown.indexOf(oldText);
  if (firstIndex === -1) {
    return null;
  }

  const secondIndex = markdown.indexOf(oldText, firstIndex + Math.max(1, oldText.length));
  if (secondIndex !== -1) {
    return null;
  }

  return {
    quote: oldText,
    prefix: markdown.slice(Math.max(0, firstIndex - 40), firstIndex),
    suffix: markdown.slice(firstIndex + oldText.length, Math.min(markdown.length, firstIndex + oldText.length + 40)),
    start: firstIndex,
    end: firstIndex + oldText.length,
  };
}

function normalizeProposalToolArgs(input: unknown): { summary: string; hunks: PromptToolHunk[] } | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "Proposal payload must be an object." };
  }

  const source = input as PromptToolArgs;
  const summary = String(source.summary || "").trim().slice(0, 240);
  const rawHunks = Array.isArray(source.hunks) ? source.hunks : [];
  const hunks: PromptToolHunk[] = [];

  for (const item of rawHunks) {
    const oldText = String((item as Record<string, unknown>)?.oldText || "");
    const newText = String((item as Record<string, unknown>)?.newText || "");
    if (!oldText.trim()) {
      return { error: "Each proposal hunk needs a non-empty oldText that matches the current note." };
    }
    if (oldText.length > 12000 || newText.length > 12000) {
      return { error: "Proposal hunks must stay under 12k characters each." };
    }
    hunks.push({ oldText, newText });
  }

  if (!summary) {
    return { error: "Proposal summary is required." };
  }
  if (hunks.length === 0) {
    return { error: "At least one proposal hunk is required." };
  }

  return { summary, hunks };
}

function buildFailureResult(message: string): ToolResultObject {
  return {
    textResultForLlm: message,
    resultType: "failure",
    error: message,
  };
}

function buildSuccessResult(message: string): ToolResultObject {
  return {
    textResultForLlm: message,
    resultType: "success",
  };
}

function buildTranscriptContext(turns: AiTurn[]) {
  const selected = turns.slice(-12);
  if (!selected.length) {
    return "No prior shared AI conversation.";
  }

  return selected
    .map((turn) => {
      const status = turn.status === "completed" ? "" : ` [${turn.status}]`;
      return `${turn.role === "user" ? turn.author.name : AI_PARTICIPANT.name}${status}: ${clampText(turn.content || "(no content)", 2000)}`;
    })
    .join("\n\n");
}

function buildOpenProposalContext(proposals: AiProposal[]) {
  const open = proposals.filter((proposal) => proposal.status === "open").slice(-6);
  if (!open.length) {
    return "No open AI proposals.";
  }

  return open
    .map((proposal) => {
      const firstHunk = proposal.hunks[0];
      const preview = firstHunk
        ? `${clampText(firstHunk.oldText, 120)} -> ${clampText(firstHunk.newText, 120)}`
        : "No hunks";
      return `- ${proposal.id}: ${proposal.summary} (${proposal.hunks.length} hunk${proposal.hunks.length === 1 ? "" : "s"})\n  ${preview}`;
    })
    .join("\n");
}

function buildPrompt(note: AiNoteContext, turns: AiTurn[], proposals: AiProposal[], actor: AiActor, prompt: string) {
  const markdown = clampText(note.markdown, 24000);
  return [
    `You are collaborating on the shared markdown note "${note.title}".`,
    `Current note markdown:\n\`\`\`markdown\n${markdown}\n\`\`\``,
    `Recent shared conversation:\n${buildTranscriptContext(turns)}`,
    `Existing open proposals:\n${buildOpenProposalContext(proposals)}`,
    `New collaborator request from ${actor.name} (${actor.kind}):\n${prompt}`,
    "Reply naturally to the collaborator.",
    `If you want to suggest note edits, call ${PROPOSAL_TOOL_NAME} once with a concise summary and one or more replacement hunks.`,
    "Each hunk.oldText must be copied exactly from the current note markdown and must be specific enough to be unique.",
    "Do not output raw JSON in chat unless the collaborator explicitly asks for it.",
    "Proposals are shown as inline diffs in the preview pane; collaborators accept or reject them there.",
  ].join("\n\n");
}

function buildSystemInstructions() {
  return [
    "You are Jot AI, a shared AI collaborator in a collaborative markdown editor.",
    "Work only from the note markdown and shared conversation supplied in the user message.",
    "Do not rely on filesystem, shell, git, web, or network tools.",
    "Use the submit_note_proposal tool for meaningful note changes so humans can review them before they touch the document.",
    "For pure insertions, wrap the insertion as a replacement of a nearby existing block so oldText remains non-empty.",
    "After a successful proposal tool call, briefly explain what you changed. Collaborators review proposals as inline diffs directly in the preview pane, not in the chat.",
  ].join("\n");
}

function createEmptyState(noteId: string): AiStateFile {
  const timestamp = nowIso();
  return {
    version: AI_STATE_VERSION,
    noteId,
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
    proposals: [],
    activeRun: null,
  };
}

function normalizeActor(actor: AiActor): AiActor {
  return {
    id: actor.id,
    name: actor.name.slice(0, 80) || (actor.kind === "owner" ? "Owner" : "Editor"),
    kind: actor.kind,
  };
}

function listOccurrences(haystack: string, needle: string) {
  const indexes: number[] = [];
  if (!needle) {
    return indexes;
  }
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return indexes;
}

function resolveProposalAnchor(markdown: string, hunk: AiProposalHunk) {
  const candidates = listOccurrences(markdown, hunk.anchor.quote);
  if (!candidates.length) {
    return { ok: false as const, reason: "The target text is no longer present in the note." };
  }

  const scored = candidates.map((candidate) => {
    let score = 0;
    const prefix = markdown.slice(Math.max(0, candidate - hunk.anchor.prefix.length), candidate);
    const suffix = markdown.slice(candidate + hunk.anchor.quote.length, candidate + hunk.anchor.quote.length + hunk.anchor.suffix.length);
    if (prefix === hunk.anchor.prefix) {
      score += 12;
    }
    if (suffix === hunk.anchor.suffix) {
      score += 12;
    }
    score -= Math.abs(candidate - hunk.anchor.start) / 8;
    return { candidate, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return { ok: false as const, reason: "The target text could not be resolved." };
  }

  const second = scored[1];
  if (second && Math.abs(best.score - second.score) < 0.5) {
    return { ok: false as const, reason: "The proposal target is now ambiguous." };
  }

  const currentText = markdown.slice(best.candidate, best.candidate + hunk.oldText.length);
  if (currentText !== hunk.oldText) {
    return { ok: false as const, reason: "The proposal target has changed since it was generated." };
  }

  return {
    ok: true as const,
    start: best.candidate,
    end: best.candidate + hunk.oldText.length,
  };
}

function computeHunkDisplay(markdown: string, hunk: AiProposalHunk, renderMarkdownToText?: (md: string) => string): ProposalHunkDisplay {
  const result = resolveProposalAnchor(markdown, hunk);
  if (!result.ok) {
    const resolveState = result.reason.toLowerCase().includes("ambiguous") ? "ambiguous" : "stale";
    return { state: resolveState, reason: result.reason };
  }

  // Convert raw markdown offsets to rendered-text offsets
  if (renderMarkdownToText) {
    const renderedText = renderMarkdownToText(markdown);
    const oldRenderedText = renderMarkdownToText(hunk.oldText);
    // Find the rendered text of the matched region in the full rendered text
    if (oldRenderedText) {
      // Try to locate the rendered old text in the full rendered output
      // Use the prefix rendered text length as an approximate start position
      const prefixMarkdown = markdown.slice(0, result.start);
      const renderedPrefix = renderMarkdownToText(prefixMarkdown);
      const approxStart = renderedPrefix.length;
      // Search near the approximate position for an exact match
      const searchStart = Math.max(0, approxStart - 20);
      const searchEnd = Math.min(renderedText.length, approxStart + oldRenderedText.length + 20);
      const searchRegion = renderedText.slice(searchStart, searchEnd);
      const idx = searchRegion.indexOf(oldRenderedText);
      if (idx !== -1) {
        const renderedStart = searchStart + idx;
        const renderedEnd = renderedStart + oldRenderedText.length;
        return {
          state: "resolved",
          renderedStart,
          renderedEnd,
        };
      }
      // Fallback: use the approximate prefix-based offset
      const fallbackEnd = Math.min(approxStart + oldRenderedText.length, renderedText.length);
      return {
        state: "resolved",
        renderedStart: approxStart,
        renderedEnd: fallbackEnd,
      };
    }
  }

  return {
    state: "resolved",
    renderedStart: result.start,
    renderedEnd: result.end,
  };
}

export class AiRuntimeManager {
  private readonly states = new Map<string, AiStateFile>();
  private readonly queueTails = new Map<string, Promise<void>>();
  private readonly pendingCounts = new Map<string, number>();
  private readonly liveRuns = new Map<string, LiveRun>();
  private clientPromise: Promise<CopilotClient> | null = null;

  constructor(
    private readonly notesDir: string,
    private readonly callbacks: AiCallbacks,
  ) {}

  serialize(noteId: string, permissions: AiPermissions): SerializedAiState {
    const state = this.loadState(noteId);
    const turns = permissions.canViewLive
      ? state.turns
      : state.turns.filter((turn) => turn.status !== "in_progress");

    return deepClone({
      identity: AI_PARTICIPANT,
      turns,
      proposals: state.proposals,
      activeRun: permissions.canViewLive ? state.activeRun : null,
      queueDepth: this.pendingCounts.get(noteId) || 0,
      permissions,
    });
  }

  async enqueuePrompt(note: AiNoteContext, actor: AiActor, prompt: string, permissions: AiPermissions): Promise<EnqueuePromptResult> {
    const normalizedActor = normalizeActor(actor);
    const trimmedPrompt = String(prompt || "").trim().slice(0, 6000);
    if (!trimmedPrompt) {
      throw new Error("Prompt is required.");
    }

    const state = this.loadState(note.id);
    const timestamp = nowIso();
    const promptTurnId = createId(12);
    state.turns.push({
      id: promptTurnId,
      role: "user",
      status: "completed",
      author: normalizedActor,
      createdAt: timestamp,
      updatedAt: timestamp,
      content: trimmedPrompt,
      proposalIds: [],
    });
    this.persistState(state);
    this.callbacks.onStateUpdated(note.id);

    const runId = createId(12);
    const previousTail = this.queueTails.get(note.id) || Promise.resolve();
    this.pendingCounts.set(note.id, (this.pendingCounts.get(note.id) || 0) + 1);
    const nextTail = previousTail
      .catch(() => {})
      .then(async () => {
        try {
          await this.processPrompt(note, normalizedActor, trimmedPrompt, promptTurnId, runId);
        } finally {
          const nextCount = Math.max(0, (this.pendingCounts.get(note.id) || 1) - 1);
          if (nextCount === 0) {
            this.pendingCounts.delete(note.id);
          } else {
            this.pendingCounts.set(note.id, nextCount);
          }
          this.callbacks.onStateUpdated(note.id);
        }
      });
    this.queueTails.set(note.id, nextTail);

    return {
      runId,
      state: this.serialize(note.id, permissions),
    };
  }

  async cancel(noteId: string, permissions: AiPermissions) {
    const state = this.loadState(noteId);
    if (!state.activeRun) {
      throw new Error("No AI run is currently active.");
    }

    const liveRun = this.liveRuns.get(noteId);
    if (!liveRun) {
      throw new Error("The active AI run can no longer be cancelled.");
    }

    liveRun.cancelRequested = true;
    state.activeRun.status = "cancelling";
    state.activeRun.updatedAt = nowIso();
    this.persistState(state);
    this.callbacks.onStateUpdated(noteId);
    await liveRun.session.abort();
    return this.serialize(noteId, permissions);
  }

  reset(noteId: string, permissions: AiPermissions) {
    const state = this.loadState(noteId);
    if (state.activeRun || (this.pendingCounts.get(noteId) || 0) > 0) {
      throw new Error("Wait for the current AI run to finish before resetting the shared conversation.");
    }
    const resetState = createEmptyState(noteId);
    resetState.createdAt = state.createdAt;
    this.states.set(noteId, resetState);
    this.persistState(resetState);
    this.callbacks.onStateUpdated(noteId);
    return this.serialize(noteId, permissions);
  }

  rejectProposal(noteId: string, proposalId: string, actor: AiActor, permissions: AiPermissions) {
    const state = this.loadState(noteId);
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error("Proposal not found.");
    }
    if (proposal.status !== "open" && proposal.status !== "stale") {
      throw new Error("Only open or stale proposals can be rejected.");
    }

    proposal.status = "rejected";
    proposal.rejectedBy = normalizeActor(actor);
    proposal.rejectedAt = nowIso();
    proposal.updatedAt = proposal.rejectedAt;
    this.persistState(state);
    this.callbacks.onStateUpdated(noteId);
    return this.serialize(noteId, permissions);
  }

  prepareProposalAcceptance(note: AiNoteContext, proposalId: string, permissions: AiPermissions): PrepareProposalAcceptanceResult {
    const state = this.loadState(note.id);
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return { ok: false, error: "Proposal not found.", state: this.serialize(note.id, permissions) };
    }
    if (proposal.status !== "open") {
      return { ok: false, error: "Only open proposals can be accepted.", state: this.serialize(note.id, permissions) };
    }

    const replacements: ProposalReplacement[] = [];
    for (const hunk of proposal.hunks) {
      const resolved = resolveProposalAnchor(note.markdown, hunk);
      if (!resolved.ok) {
        proposal.status = "stale";
        proposal.staleReason = resolved.reason;
        proposal.updatedAt = nowIso();
        this.persistState(state);
        this.callbacks.onStateUpdated(note.id);
        return {
          ok: false,
          error: resolved.reason,
          state: this.serialize(note.id, permissions),
        };
      }
      replacements.push({
        hunkId: hunk.id,
        start: resolved.start,
        end: resolved.end,
        oldText: hunk.oldText,
        newText: hunk.newText,
      });
    }

    replacements.sort((a, b) => b.start - a.start);
    return {
      ok: true,
      replacements,
      proposal: deepClone(proposal),
      state: this.serialize(note.id, permissions),
    };
  }

  markProposalAccepted(noteId: string, proposalId: string, actor: AiActor, permissions: AiPermissions, baseServerCounter: number) {
    const state = this.loadState(noteId);
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error("Proposal not found.");
    }

    proposal.status = "accepted";
    proposal.acceptedBy = normalizeActor(actor);
    proposal.acceptedAt = nowIso();
    proposal.updatedAt = proposal.acceptedAt;
    proposal.baseServerCounter = baseServerCounter;
    delete proposal.staleReason;
    this.persistState(state);
    this.callbacks.onStateUpdated(noteId);
    return this.serialize(noteId, permissions);
  }

  markNoteContentChanged(note: AiNoteContext) {
    const state = this.loadState(note.id);
    let changed = false;
    for (const proposal of state.proposals) {
      if (proposal.status !== "open") {
        continue;
      }
      let becameStale = false;
      for (const hunk of proposal.hunks) {
        const newDisplay = computeHunkDisplay(note.markdown, hunk, this.callbacks.renderMarkdownToText);
        const prevDisplay = hunk.display;
        if (
          prevDisplay?.state !== newDisplay.state
          || prevDisplay?.renderedStart !== newDisplay.renderedStart
          || prevDisplay?.renderedEnd !== newDisplay.renderedEnd
          || prevDisplay?.reason !== newDisplay.reason
        ) {
          hunk.display = newDisplay;
          changed = true;
        }
        if (newDisplay.state !== "resolved") {
          becameStale = true;
        }
      }
      if (becameStale) {
        proposal.status = "stale";
        const firstBadHunk = proposal.hunks.find((h) => h.display?.state !== "resolved");
        proposal.staleReason = firstBadHunk?.display?.reason ?? "The proposal target has changed.";
        proposal.updatedAt = nowIso();
        changed = true;
      }
    }

    if (changed) {
      this.persistState(state);
      this.callbacks.onStateUpdated(note.id);
    }
  }

  deleteState(noteId: string) {
    this.states.delete(noteId);
    this.queueTails.delete(noteId);
    this.pendingCounts.delete(noteId);
    this.liveRuns.delete(noteId);
    try {
      fs.unlinkSync(this.aiStatePath(noteId));
    } catch {}
  }

  private loadState(noteId: string) {
    const cached = this.states.get(noteId);
    if (cached) {
      return cached;
    }

    let state = createEmptyState(noteId);
    const filePath = this.aiStatePath(noteId);
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AiStateFile;
        state = {
          version: AI_STATE_VERSION,
          noteId,
          createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso(),
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
          turns: Array.isArray(parsed.turns) ? parsed.turns : [],
          proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
          activeRun: parsed.activeRun || null,
        };
      } catch {
        state = createEmptyState(noteId);
      }
    }

    if (state.activeRun) {
      const interruptedTurn = state.turns.find((turn) => turn.id === state.activeRun?.assistantTurnId);
      if (interruptedTurn && interruptedTurn.status === "in_progress") {
        interruptedTurn.status = "failed";
        interruptedTurn.error = "The AI run was interrupted when the server restarted.";
        interruptedTurn.updatedAt = nowIso();
      }
      state.activeRun = null;
      state.updatedAt = nowIso();
      this.writeStateFile(state);
    }

    this.states.set(noteId, state);
    return state;
  }

  private persistState(state: AiStateFile) {
    state.updatedAt = nowIso();
    this.writeStateFile(state);
  }

  private writeStateFile(state: AiStateFile) {
    fs.writeFileSync(this.aiStatePath(state.noteId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private aiStatePath(noteId: string) {
    return path.join(this.notesDir, `${noteId}.ai.json`);
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const client = new CopilotClient({
          cwd: process.cwd(),
          logLevel: "error",
        });
        await client.start();
        return client;
      })().catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  private async processPrompt(note: AiNoteContext, actor: AiActor, prompt: string, promptTurnId: string, runId: string) {
    const state = this.loadState(note.id);
    const startedAt = nowIso();
    const assistantTurnId = createId(12);
    const assistantTurn: AiTurn = {
      id: assistantTurnId,
      role: "assistant",
      status: "in_progress",
      author: AI_PARTICIPANT,
      createdAt: startedAt,
      updatedAt: startedAt,
      content: "",
      proposalIds: [],
      inReplyToTurnId: promptTurnId,
    };

    state.turns.push(assistantTurn);
    state.activeRun = {
      id: runId,
      promptTurnId,
      assistantTurnId,
      status: "running",
      createdAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      content: "",
      toolActivities: [],
    };
    this.persistState(state);
    this.callbacks.onStateUpdated(note.id);

    let finalContent = "";
    let finalError = "";
    let session: CopilotSession | null = null;
    let sessionCancelled = false;

    try {
      const client = await this.getClient();
      const proposalIds = new Set<string>();
      session = await client.createSession({
        clientName: "jot",
        model: DEFAULT_MODEL,
        streaming: true,
        workingDirectory: process.cwd(),
        availableTools: [PROPOSAL_TOOL_NAME],
        systemMessage: {
          content: buildSystemInstructions(),
        },
        tools: [
          defineTool(PROPOSAL_TOOL_NAME, {
            description: "Create a reviewable proposal for note changes using exact oldText/newText replacement hunks.",
            skipPermission: true,
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Short summary of the proposed note change." },
                hunks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      oldText: { type: "string" },
                      newText: { type: "string" },
                    },
                    required: ["oldText", "newText"],
                  },
                },
              },
              required: ["summary", "hunks"],
            },
            handler: (args) => {
              const parsed = normalizeProposalToolArgs(args);
              if ("error" in parsed) {
                return buildFailureResult(parsed.error);
              }

              const hunks: AiProposalHunk[] = [];
              for (const rawHunk of parsed.hunks) {
                const anchor = buildProposalAnchor(note.markdown, rawHunk.oldText);
                if (!anchor) {
                  return buildFailureResult("Each proposal hunk oldText must match a unique span in the current note.");
                }
                const hunk: AiProposalHunk = {
                  id: createId(10),
                  oldText: rawHunk.oldText,
                  newText: rawHunk.newText,
                  anchor,
                };
                hunk.display = computeHunkDisplay(note.markdown, hunk, this.callbacks.renderMarkdownToText);
                hunks.push(hunk);
              }

              const proposalId = createId(12);
              proposalIds.add(proposalId);
              const proposal: AiProposal = {
                id: proposalId,
                summary: parsed.summary,
                status: "open",
                sourceTurnId: assistantTurnId,
                createdAt: nowIso(),
                updatedAt: nowIso(),
                baseServerCounter: note.serverCounter,
                hunks,
              };

              const liveState = this.loadState(note.id);
              liveState.proposals.push(proposal);
              const liveAssistantTurn = liveState.turns.find((turn) => turn.id === assistantTurnId);
              if (liveAssistantTurn && !liveAssistantTurn.proposalIds.includes(proposalId)) {
                liveAssistantTurn.proposalIds.push(proposalId);
                liveAssistantTurn.updatedAt = nowIso();
              }
              this.persistState(liveState);
              this.callbacks.onStateUpdated(note.id);

              return buildSuccessResult(`Created proposal ${proposalId}. Collaborators can review it as an inline diff in the preview.`);
            },
          }),
        ],
        onPermissionRequest: () => ({ kind: "approved" }),
      });

      this.liveRuns.set(note.id, { session, cancelRequested: false });

      session.on("assistant.message_delta", (event: any) => {
        const delta = String(event?.data?.deltaContent || "");
        if (!delta) {
          return;
        }

        const liveState = this.loadState(note.id);
        const liveTurn = liveState.turns.find((turn) => turn.id === assistantTurnId);
        if (!liveState.activeRun || !liveTurn) {
          return;
        }

        liveState.activeRun.content += delta;
        liveState.activeRun.updatedAt = nowIso();
        liveTurn.content = liveState.activeRun.content;
        liveTurn.updatedAt = liveState.activeRun.updatedAt;
        finalContent = liveTurn.content;
        this.persistState(liveState);
        this.callbacks.onMessageDelta({
          noteId: note.id,
          runId,
          assistantTurnId,
          delta,
          content: liveState.activeRun.content,
        });
      });

      session.on("assistant.message", (event: any) => {
        finalContent = String(event?.data?.content || finalContent || "");
      });

      session.on("tool.execution_start", (event: any) => {
        const liveState = this.loadState(note.id);
        if (!liveState.activeRun) {
          return;
        }
        const activity: AiToolActivity = {
          id: createId(10),
          toolCallId: String(event?.data?.toolCallId || createId(8)),
          toolName: String(event?.data?.toolName || "tool"),
          status: "running",
          startedAt: nowIso(),
        };
        liveState.activeRun.toolActivities.push(activity);
        liveState.activeRun.updatedAt = nowIso();
        this.persistState(liveState);
        this.callbacks.onToolActivity({ noteId: note.id, runId, activity: deepClone(activity) });
      });

      session.on("tool.execution_complete", (event: any) => {
        const liveState = this.loadState(note.id);
        if (!liveState.activeRun) {
          return;
        }
        const toolCallId = String(event?.data?.toolCallId || "");
        const activity = liveState.activeRun.toolActivities.find((item) => item.toolCallId === toolCallId);
        if (!activity) {
          return;
        }
        activity.status = event?.data?.success ? "completed" : "failed";
        activity.completedAt = nowIso();
        activity.resultSummary = stringifyToolResult(event?.data?.result);
        activity.error = event?.data?.error ? String(event.data.error) : undefined;
        liveState.activeRun.updatedAt = activity.completedAt;
        this.persistState(liveState);
        this.callbacks.onToolActivity({ noteId: note.id, runId, activity: deepClone(activity) });
      });

      session.on("session.error", (event: any) => {
        finalError = String(event?.data?.message || "AI request failed.");
      });

      const idle = new Promise<void>((resolve) => {
        session?.on("session.idle", () => resolve());
      });

      await session.send({
        prompt: buildPrompt(note, state.turns.filter((turn) => turn.id !== assistantTurnId), state.proposals, actor, prompt),
      });
      await idle;
      sessionCancelled = Boolean(this.liveRuns.get(note.id)?.cancelRequested);
    } catch (error) {
      finalError = error instanceof Error ? error.message : String(error);
    } finally {
      if (session) {
        try {
          await session.disconnect();
        } catch {}
      }
      this.liveRuns.delete(note.id);
      this.finishRun(note.id, assistantTurnId, {
        cancelled: sessionCancelled,
        content: finalContent,
        error: finalError,
      });
    }
  }

  private finishRun(noteId: string, assistantTurnId: string, result: { cancelled: boolean; content: string; error: string }) {
    const state = this.loadState(noteId);
    const assistantTurn = state.turns.find((turn) => turn.id === assistantTurnId);
    if (!assistantTurn) {
      return;
    }

    const timestamp = nowIso();
    assistantTurn.updatedAt = timestamp;
    assistantTurn.content = result.content || assistantTurn.content;
    if (result.cancelled) {
      assistantTurn.status = "cancelled";
      assistantTurn.error = "AI generation was cancelled.";
    } else if (result.error) {
      assistantTurn.status = "failed";
      assistantTurn.error = result.error;
    } else {
      assistantTurn.status = "completed";
      delete assistantTurn.error;
      if (!assistantTurn.content.trim() && assistantTurn.proposalIds.length > 0) {
        assistantTurn.content = `Created ${assistantTurn.proposalIds.length} reviewable proposal${assistantTurn.proposalIds.length === 1 ? "" : "s"}.`;
      }
    }

    state.activeRun = null;
    this.persistState(state);
    this.callbacks.onStateUpdated(noteId);
  }
}
