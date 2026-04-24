import path from "node:path";

export function cliArg(name: string) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.split("=").slice(1).join("=") : null;
}

export const port = Number(cliArg("port") || process.env.PORT || 3210);
export const dataDir = cliArg("data") || process.env.DATA_DIR || path.join(process.cwd(), "data");
export const notesDir = path.join(dataDir, "notes");
export const authFilePath = path.join(dataDir, "auth.json");

export const ownerSessionCookieName = "md_owner_session";
export const ownerLocalStorageTokenKey = "md_owner_token";
export const commenterIdCookieName = "md_commenter_id";
export const commenterNameCookieName = "md_commenter_name";
export const ownerCookieMaxAgeSeconds = 60 * 60 * 24 * 30;
export const commenterCookieMaxAgeSeconds = 60 * 60 * 24 * 365;
