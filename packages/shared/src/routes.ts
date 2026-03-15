import { z } from "zod";
import { defineRoute } from "./typed-api.js";

export const TodoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  completed: z.boolean(),
});

export type Todo = z.infer<typeof TodoSchema>;

export const getTodo = defineRoute({
  method: "GET" as const,
  route: "todos/{id}",
  params: z.object({ id: z.string().uuid() }),
  body: z.void(),
  response: TodoSchema,
});

export const createTodo = defineRoute({
  method: "POST" as const,
  route: "todos",
  params: z.object({}),
  body: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  response: TodoSchema,
});
