import { registerRoute } from "../helpers/validated-handler.js";
import { getTodo } from "@my-app/shared";

registerRoute("getTodo", getTodo, async (req) => {
  req.context.log(`Fetching todo ${req.params.id}`);

  return {
    id: req.params.id,
    title: "Sample todo",
    completed: false,
  };
});
