import { registerHttpFlat } from "./lib/http-function.js";
import { defs, managementDefs } from "./functions/index.js";
import { app } from "@azure/functions";

registerHttpFlat(app, defs);
registerHttpFlat(app, managementDefs, "management", "management");
