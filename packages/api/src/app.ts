import { registerHttpAll } from "./lib/http-function.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

registerHttpAll(app, defs);
