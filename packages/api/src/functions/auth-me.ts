import { defaultMiddleware, defineHttp } from "../lib/http.js";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

const unauthorizedResponse = { status: 401, jsonBody: { message: "Unauthorized" } } as const;

export const authMe = defineHttp({
  middleware: async (request, context, next) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return unauthorizedResponse;
    }
    const user = usersByToken.get(authHeader.replace("Bearer ", ""));
    if (!user) {
      return unauthorizedResponse;
    }
    return await defaultMiddleware(request, context, next);
  },
  handler: async (request) => {
    const token = request.headers.get("authorization")!.replace("Bearer ", "");
    const user = usersByToken.get(token)!;
    return { status: 200, jsonBody: user } as const;
  },
});
