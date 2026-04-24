import { authPageMode } from "$lib/server/auth-page";

export function load() {
  return { mode: authPageMode() };
}
