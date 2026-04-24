import { error } from "@sveltejs/kit";

import { findSharedNotePageData } from "$lib/server/share-page";

export function load({ params }) {
  const note = findSharedNotePageData(params.shareId);
  if (!note) {
    throw error(404, "Shared note not found.");
  }

  return {
    shareId: params.shareId,
    title: note.title,
    shareAccess: note.shareAccess,
  };
}
