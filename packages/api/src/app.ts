import { registerAll } from "./typed-api.js";
import { getTodo } from "./functions/get-todo.js";
import { createTodo } from "./functions/create-todo.js";

registerAll({ getTodo, createTodo });
