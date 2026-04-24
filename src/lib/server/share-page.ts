import fs from "node:fs";
import path from "node:path";

import { notesDir } from "./config.js";

export type ShareAccess = "none" | "view" | "comment" | "edit";

export type SharedNotePageData = {
  title: string;
  shareAccess: ShareAccess;
};

type NoteMetaFile = {
  title?: string;
  shareId?: string;
  shareAccess?: ShareAccess;
};

export function findSharedNotePageData(shareId: string): SharedNotePageData | null {
  let files: string[];
  try {
    files = fs.readdirSync(notesDir).filter((file) => file.endsWith(".json") && !file.endsWith(".ai.json"));
  } catch {
    return null;
  }

  for (const file of files) {
    const meta = readJson<NoteMetaFile | null>(path.join(notesDir, file), null);
    if (meta?.shareId !== shareId) {
      continue;
    }

    const shareAccess = meta.shareAccess || "none";
    if (shareAccess === "none") {
      return null;
    }

    return {
      title: meta.title || "Shared note",
      shareAccess,
    };
  }

  return null;
}

function readJson<T>(filePath: string, fallback: T) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}
