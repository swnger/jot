# Product Requirements Document: Core Product

**Built on the GitHub Copilot SDK**

| Field | Value |
| ----- | ----- |
| Status | Draft |
| Version | 0.1.0-core |
| Date | 2026-03-31 |
| Author | swngr |
| Repository | github.com/swnger/spectacle-ai |

---

## 1. Core Vision

Build a real-time collaborative markdown editor for GitHub-backed markdown files where teams can co-author docs with an AI collaborator inside the editor. The AI helps draft and revise content, appears as a visible participant when making document changes, and all approved changes are written back through a branch and pull request workflow.

This is the smallest version of the product that still fulfills the vision. If any of the capabilities below are removed, the product stops being the intended product:

1. GitHub-backed markdown files are the source of truth.
2. Multiple people can edit the same file in real time.
3. A shared AI can help draft and revise content in context.
4. AI contributions are visible, attributable, and reviewable.
5. Approved changes can be written back to GitHub through branch + PR.

## 2. Problem Statement

Teams write important product and technical documents in markdown, but today they must switch between repository tools, editors, and separate AI products. That breaks collaboration, loses context, and makes AI contributions harder to trust.

The product solves this by combining collaborative markdown editing, shared AI assistance, visible AI participation, and GitHub-native write-back in one workflow.

## 3. Core Goals

| ID | Goal | Success Metric |
| -- | ---- | -------------- |
| G1 | Enable real-time collaborative editing of GitHub-backed markdown files | 2+ users can edit the same file with low latency |
| G2 | Provide shared AI assistance for drafting and revision inside the editor | Users can generate or transform content without leaving the file |
| G3 | Make AI a visible collaborator rather than an invisible background system | AI-generated document changes are attributable and reviewable |
| G4 | Keep GitHub as the system of record | Users can open/create files from GitHub and write approved changes back through branch + PR |

## 4. Non-Goals For Core

- Private AI mode
- Version history, named snapshots, and restore
- Inline comments and mentions
- Drag-and-drop image upload
- File linking to GitHub issues and pull requests
- Reusable templates, style guides, and specialized writing modes
- Rich audit export, retention controls, and advanced workspace governance
- External knowledge sources or non-GitHub integrations
- Advanced output types such as checklists, comments, or promotion flows

## 5. Core Users

| Persona | Core Need |
| ------- | --------- |
| Product Manager | Draft and revise PRDs/specs collaboratively in a repo-backed workflow |
| Engineer / Tech Lead | Co-author RFCs, READMEs, and architecture docs with repo-native AI assistance |
| Small cross-functional team | Share one live doc, one AI context, and one write-back path |

## 6. Core User Stories

- As a user, I want to open or create a markdown file from a permitted GitHub repository so the repo remains the source of truth.
- As a user, I want to edit that file with teammates in real time so collaborative writing feels immediate.
- As a user, I want to ask a shared AI to rewrite, summarize, or draft content from the editor so I can move faster in context.
- As a user, I want AI-generated document changes to appear as visible collaborator activity with clear attribution so I can trust and review them.
- As a user, I want to accept or reject AI changes before finalizing important edits so I stay in control of the document.
- As a user, I want to write the approved file changes back to GitHub through a branch and pull request so the workflow fits how teams already ship docs.

## 7. Core Functional Requirements

### 7.1 Repository-Backed Markdown Editing

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| CFR-1 | Users can browse, open, create, and edit markdown files in permitted GitHub repositories and branches | P0 |
| CFR-2 | GitHub repositories and branches are the source of truth for accessible files | P0 |
| CFR-3 | The editor preserves valid markdown with no lossy transformation | P0 |

### 7.2 Real-Time Collaboration

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| CFR-4 | Multiple users can collaboratively edit the same markdown file in real time | P0 |
| CFR-5 | Users can see collaborator presence in the active file | P0 |

### 7.3 Shared AI Assistance

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| CFR-6 | Each file has one shared multi-turn AI conversation available to collaborators with file access | P0 |
| CFR-7 | The AI can perform core writing actions in context: write/edit, summarize, outline | P0 |
| CFR-8 | AI responses stream progressively in the UI | P0 |
| CFR-9 | The current file is the default AI context | P0 |

### 7.4 Visible and Reviewable AI Collaboration

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| CFR-10 | AI-generated document changes are shown in a reviewable form before final acceptance for non-trivial edits | P0 |
| CFR-11 | The AI can appear as a named collaborator with distinct visual attribution when producing visible edits or streamed file changes | P0 |
| CFR-12 | Accepted AI changes are attributable in the editor activity and resulting diff | P0 |
| CFR-13 | If a generated change no longer applies cleanly to the current file state, it must be marked stale before application | P0 |

### 7.5 GitHub Write-Back

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| CFR-14 | Approved changes are written back through a dedicated branch and pull request workflow, not direct mutation of the target branch | P0 |
| CFR-15 | Before write-back, the product validates the working copy against the latest accessible target branch state and blocks unsafe write-back on conflict or drift | P0 |

## 8. Core User Flow

1. A user opens or creates a markdown file from a permitted GitHub repository.
2. Teammates join the file and collaborate in real time.
3. A collaborator prompts the shared AI to rewrite, summarize, outline, or draft content.
4. The AI responds in context and appears as a visible collaborator when it proposes document changes.
5. Collaborators review and accept or reject the AI contribution.
6. The team writes the approved changes back through a branch and pull request.

## 9. Core Design Principles

1. **GitHub-backed by default.** The repository is the system of record.
2. **Collaboration-first.** Human collaborators and the AI work in the same file experience.
3. **AI as visible collaborator.** AI contributions should be seen, attributed, and understood.
4. **Human-controlled changes.** Users remain responsible for accepting meaningful document changes.
5. **Markdown-first.** The product must preserve clean markdown authoring and output.

## 10. Core Success Metrics

| Goal | KPI |
| ---- | --- |
| Collaborative editing | Teams successfully co-edit the same file with low-latency sync |
| Embedded AI usage | Shared AI is used in active file sessions to draft or revise content |
| Trust in AI collaboration | AI-generated document mutations are attributable and reviewable |
| GitHub-native workflow | Approved edits are successfully written back through branch + PR |
