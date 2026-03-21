import { z } from "zod";
import { defineHttp } from "../lib/http-function.js";

export const createTodo = defineHttp({
  parser: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  handler: async ({ context, parsed }) => {
    context.log(`Creating todo: ${parsed.title}`);

    return {
      jsonBody: {
        id: crypto.randomUUID(),
        title: parsed.title,
        completed: parsed.completed,
      },
    };
  },
});
