import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/SETUP.md")({
  server: {
    handlers: {
      GET: () =>
        Response.redirect(
          "https://raw.githubusercontent.com/spaceobject-ai/spaceobject/refs/heads/main/SETUP.md",
          307,
        ),
    },
  },
});
