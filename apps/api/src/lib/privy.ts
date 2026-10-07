import { PrivyClient } from "@privy-io/node";

export function createPrivyClient(appId: string, appSecret: string) {
  return new PrivyClient({
    appId,
    appSecret,
  });
}
