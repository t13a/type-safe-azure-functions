import { registerRoute } from "../helpers/validated-handler.js";
import { createTodo } from "@my-app/shared";

registerRoute("createTodo", createTodo, async (req) => {
  req.context.log(`Creating todo: ${req.body.title}`);

  return {
    id: crypto.randomUUID(),
    title: req.body.title,
    completed: req.body.completed,
  };
});
