import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const getTodo = defineFunction({
  methods: ["GET"],
  route: "todos/{id}",
  authLevel: "anonymous",
  parse: {
    params: z.object({ id: z.string().uuid() }),
  },
  handler: async (request, context, { params }) => {
    context.log(`Fetching todo ${params.id}`);

    return {
      jsonBody: {
        id: params.id,
        title: "Sample todo",
        completed: false,
      },
    };
  },
});
