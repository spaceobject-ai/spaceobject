import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PRIVY_APP_ID, PRIVY_AUTH_ORIGIN } from "@spaceobject/core";
import { Alert, AlertDescription, AlertTitle } from "@spaceobject/ui/components/alert";
import { Button } from "@spaceobject/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@spaceobject/ui/components/card";
import { Spinner } from "@spaceobject/ui/components/spinner";
import { accountLabel } from "../lib/privy";

export const Route = createFileRoute("/auth/verify")({
  validateSearch: (search) => ({
    user_code: typeof search.user_code === "string" ? search.user_code : "",
  }),
  component: AuthorizeRoute,
});

function AuthorizeRoute() {
  return (
    <ClientOnly fallback={null}>
      <AuthorizeProvider />
    </ClientOnly>
  );
}

function AuthorizeProvider() {
  // Matches the .dark class set on <html> by the theme script and ThemeToggle.
  const dark = document.documentElement.classList.contains("dark");
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: dark ? "dark" : "light",
          accentColor: dark ? "#e4e4e7" : "#27272a",
        },
      }}
    >
      <AuthorizePage />
    </PrivyProvider>
  );
}

type Result = "approved" | "denied" | "error";

function AuthorizePage() {
  const privy = usePrivy();
  const search = Route.useSearch();
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(action: "approve" | "deny") {
    setSubmitting(true);

    const accessToken = await privy.getAccessToken().catch(() => null);
    const res = accessToken
      ? await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/device_verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "privy-app-id": PRIVY_APP_ID,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ user_code: search.user_code, action }),
        }).catch(() => null)
      : null;

    setSubmitting(false);
    if (!res?.ok) return setResult("error");
    setResult(action === "approve" ? "approved" : "denied");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6">
      <Card className="w-full">
        <AuthorizeContent
          privy={privy}
          result={result}
          submit={submit}
          submitting={submitting}
          userCode={search.user_code}
        />
      </Card>
    </main>
  );
}

function AuthorizeContent(props: {
  privy: ReturnType<typeof usePrivy>;
  result: Result | null;
  submit: (action: "approve" | "deny") => Promise<void>;
  submitting: boolean;
  userCode: string;
}) {
  if (!props.userCode)
    return (
      <CardHeader>
        <CardTitle>No code found</CardTitle>
        <CardDescription>
          Open the link shown by the Space Object CLI, or restart the login with{" "}
          <code className="font-mono">sun auth login</code>.
        </CardDescription>
      </CardHeader>
    );

  if (props.result === "approved")
    return (
      <CardHeader>
        <CardTitle>Access approved</CardTitle>
        <CardDescription>You can close this tab and return to the CLI.</CardDescription>
      </CardHeader>
    );

  if (props.result === "denied")
    return (
      <CardHeader>
        <CardTitle>Access denied</CardTitle>
        <CardDescription>You can close this tab.</CardDescription>
      </CardHeader>
    );

  if (props.result === "error")
    return (
      <CardContent>
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            The code may be invalid or expired — restart the login with{" "}
            <code className="font-mono">sun auth login</code>.
          </AlertDescription>
        </Alert>
      </CardContent>
    );

  if (!props.privy.ready)
    return (
      <CardContent className="flex justify-center py-8">
        <Spinner />
      </CardContent>
    );

  return (
    <>
      <CardHeader>
        <CardTitle>Authorize the Space Object CLI</CardTitle>
        <CardDescription>
          A command line on another device is asking for access to your Space Object account. Only
          continue if the code below matches the one shown in your terminal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="py-4 text-center font-mono text-3xl font-semibold tracking-widest">
          {props.userCode}
        </p>
      </CardContent>
      {!props.privy.authenticated ? (
        <CardFooter>
          <Button className="w-full" onClick={() => props.privy.login()}>
            Log in to continue
          </Button>
        </CardFooter>
      ) : (
        <CardFooter className="flex-col gap-3">
          <div className="flex w-full gap-3">
            <Button
              className="flex-1"
              disabled={props.submitting}
              onClick={() => props.submit("approve")}
            >
              {props.submitting && <Spinner data-icon="inline-start" />}
              Approve
            </Button>
            <Button
              className="flex-1"
              disabled={props.submitting}
              onClick={() => props.submit("deny")}
              variant="outline"
            >
              Deny
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {props.privy.user && (
              <>
                Approving as <span className="font-mono">{accountLabel(props.privy.user)}</span>{" "}
                ·{" "}
              </>
            )}
            <button
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              disabled={props.submitting}
              onClick={() => props.privy.logout()}
              type="button"
            >
              Switch account
            </button>
          </p>
        </CardFooter>
      )}
    </>
  );
}
