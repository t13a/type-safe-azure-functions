import { z } from "zod";
import { defineFunction } from "../typed-api.js";

export const createTodo = defineFunction(
  {
    method: "POST",
    route: "todos",
    params: z.object({}),
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
  },
  async (request, context, { body }) => {
    context.log(`Creating todo: ${body.title}`);

    return {
      jsonBody: {
        id: crypto.randomUUID(),
        title: body.title,
        completed: body.completed,
      },
    };
  },
);
