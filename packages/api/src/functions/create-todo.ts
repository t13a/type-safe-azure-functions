import { z } from "zod";
import { http, withCatchError } from "../lib/http-function-v2/index.js";

export const createTodo = http({
  parser: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  handler: withCatchError(async (c) => {
    c.context.log(`Creating todo: ${c.parsed.title}`);

    return {
      jsonBody: {
        id: crypto.randomUUID(),
        title: c.parsed.title,
        completed: c.parsed.completed,
      },
    };
  }),
});
