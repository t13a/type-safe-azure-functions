import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const getTodo = defineFunction({
  authLevel: "anonymous",
  parse: {
    body: z.object({ id: z.string().uuid() }),
  },
  handler: async (request, context, { body }) => {
    context.log(`Fetching todo ${body.id}`);

    return {
      jsonBody: {
        id: body.id,
        title: "Sample todo",
        completed: false,
      },
    };
  },
});
