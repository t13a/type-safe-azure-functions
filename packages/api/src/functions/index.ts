import { subRoute } from "../lib/http-function-v2/index.js";
import { authMe } from "./auth-me.js";
import { createTodo } from "./create-todo.js";
import { listTodos } from "./list-todos.js";
import { defs as managementDefs } from "./management/index.js";

const management = subRoute(managementDefs);

export const defs = { management, listTodos, createTodo, authMe } as const;
