import { registerAll } from "./lib/http-function-v2/index.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

registerAll(app, defs);
