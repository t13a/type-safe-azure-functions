import { registerHttp } from "./lib/http-function.js";
import { defs, managementDefs } from "./functions/index.js";
import { app } from "@azure/functions";

for (const [key, def] of Object.entries(defs)) {
  registerHttp(app, key, key, def);
}
for (const [key, def] of Object.entries(managementDefs)) {
  registerHttp(app, `management-${key}`, `management/${key}`, def);
}
