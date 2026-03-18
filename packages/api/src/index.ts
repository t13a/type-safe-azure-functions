import { getTodo } from "./functions/get-todo.js";
import { createTodo } from "./functions/create-todo.js";

export type { FunctionDefinition, ParsedInput } from "./lib/define-function.js";

export const functions = { getTodo, createTodo } as const;
