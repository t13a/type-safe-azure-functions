import { z } from "zod";
import { defineFunction } from "../typed-api.js";

export const getTodo = defineFunction(
  {
    method: "GET",
    route: "todos/{id}",
    params: z.object({ id: z.string().uuid() }),
    body: z.void(),
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
