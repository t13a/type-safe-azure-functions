import { createClient as createGenericClient } from "./lib/create-client.js";
import { functions } from "./functions/index.js";

export function createClient(baseUrl: string) {
  return createGenericClient(baseUrl, functions);
}
