import { getTodo } from "./get-todo.js";
import { createTodo } from "./create-todo.js";

export const functions = { getTodo, createTodo } as const;
