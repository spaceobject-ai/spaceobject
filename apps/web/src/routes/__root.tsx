import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "@spaceobject/ui/globals.css";
import { FileQuestionMarkIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@spaceobject/ui/components/empty";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Space Object",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionMarkIcon />
          </EmptyMedia>
          <EmptyTitle>404 - Page not found</EmptyTitle>
          <EmptyDescription>The page you&apos;re looking for doesn&apos;t exist.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  );
}

function RootDocument(props: { children: ReactNode }) {
  return (
    <html className="dark" lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.remove('dark')}catch{}",
          }}
        />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
