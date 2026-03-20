import { z } from "zod";
import { defineHttp } from "../lib/http.js";

export const createTodo = defineHttp({
  parser: {
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
  },
  handler: async (_request, context, { body }) => {
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
