import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const createTodo = defineFunction({
  methods: ["POST"],
  route: "todos",
  authLevel: "anonymous",
  parse: {
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
  },
  handler: async (request, context, { body }) => {
    context.log(`Creating todo: ${body.title}`);

    return {
      jsonBody: {
        id: crypto.randomUUID(),
        title: body.title,
        completed: body.completed,
      },
    };
  },
});
