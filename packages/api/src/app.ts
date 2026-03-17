import { registerFunction } from "./lib/register-function.js";
import { functions } from "./functions/index.js";

for (const [name, def] of Object.entries(functions)) {
  registerFunction(name, def)
}
