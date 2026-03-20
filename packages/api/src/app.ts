import { registerHttp } from "./lib/http.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

for (const [name, def] of Object.entries(defs)) {
  registerHttp(app, name, def);
}
