import { z } from "zod";
import { defaultErrorHandler, defineHttp } from "../lib/http";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

const unauthorizedErrorHandler = () => {
  return { status: 401 as const, jsonBody: { message: "Unauthorized" } } as const;
};

export const authMe = defineHttp({
  parser: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/).transform((arg) => {
        return { token: arg.replace("Bearer ", "") };
      }),
    }),
  },
  handler: async (_request, context, { headers }) => {
    context.log(`Autenticating token: ${headers.authorization.token}`);

    const token = headers.authorization.token;
    const user = usersByToken.get(token);

    if (!user) {
      return unauthorizedErrorHandler();
    }

    return { status: 200, jsonBody: user } as const;
  },
  errorHandler: async (request, context, error) => {
    if (!request.headers.has("authorization")) {
      return unauthorizedErrorHandler();
    }

    return defaultErrorHandler(request,context,error);
  },
});
