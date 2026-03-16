import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const getTodo = defineFunction(
  {
    method: "GET",
    route: "todos/{id}",
    params: z.object({ id: z.string().uuid() }),
  },
  async (request, context, { params }) => {
    context.log(`Fetching todo ${params.id}`);

    return {
      jsonBody: {
        id: params.id,
        title: "Sample todo",
        completed: false,
      },
    };
  },
);
