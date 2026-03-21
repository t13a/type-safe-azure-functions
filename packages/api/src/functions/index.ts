import { authMe } from "./auth-me.js";
import { createTodo } from "./create-todo.js";
import { listTodos } from "./list-todos.js";
export { defs as managementDefs } from "./management/index.js";

export const defs = { listTodos, createTodo, authMe } as const;
