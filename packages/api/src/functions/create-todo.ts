import { z } from "zod";
import { defineHttp } from "../lib/http-function.js";

export const createTodo = defineHttp({
  parser: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  handler: async (c) => {
    c.context.log(`Creating todo: ${c.parsed.title}`);

    return {
      jsonBody: {
        id: crypto.randomUUID(),
        title: c.parsed.title,
        completed: c.parsed.completed,
      },
    };
  },
});
