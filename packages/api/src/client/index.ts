import { createClient as createGenericClient } from "./api-client.js";
import { functions } from "../functions/index.js";

export type { ApiClient } from "./api-client.js";

export function createClient(baseUrl: string) {
  return createGenericClient(baseUrl, functions);
}
