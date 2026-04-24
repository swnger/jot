import fs from "node:fs";

import { authFilePath } from "./config.js";

type AuthData = {
  passwordSalt?: string;
  passwordHash?: string;
};

export function authPageMode(): "login" | "setup" {
  const auth = readJson<AuthData | null>(authFilePath, null);
  return auth?.passwordSalt && auth.passwordHash ? "login" : "setup";
}

function readJson<T>(filePath: string, fallback: T) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}
