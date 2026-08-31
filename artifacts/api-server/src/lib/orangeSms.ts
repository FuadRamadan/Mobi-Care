const ORANGE_TOKEN_URL = "https://api.orange.com/oauth/v3/token";
const ORANGE_SMS_URL = "https://api.orange.com/smsmessaging/v1/outbound";
const REQUEST_TIMEOUT_MS = 12_000;

export interface OrangeSmsCredentials {
  clientId: string;
  clientSecret: string;
  senderAddress: string;
  senderName?: string | null;
}

export class OrangeSmsError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "OrangeSmsError";
  }
}

async function orangeAccessToken(
  credentials: Pick<OrangeSmsCredentials, "clientId" | "clientSecret">,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const authorization = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await fetch(ORANGE_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OrangeSmsError(
        response.status === 401
          ? "Orange rejected the client ID or client secret."
          : "Orange authentication is currently unavailable.",
        response.status,
      );
    }
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new OrangeSmsError("Orange did not return an access token.");
    }
    return data.access_token;
  } catch (error) {
    if (error instanceof OrangeSmsError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OrangeSmsError("Orange authentication timed out.");
    }
    throw new OrangeSmsError("Could not connect to Orange.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendOrangeSms(
  credentials: OrangeSmsCredentials,
  recipient: string,
  message: string,
): Promise<{ providerMessageId: string | null }> {
  const accessToken = await orangeAccessToken(credentials);
  const senderAddress = `tel:${credentials.senderAddress}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${ORANGE_SMS_URL}/${encodeURIComponent(senderAddress)}/requests`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          outboundSMSMessageRequest: {
            address: `tel:${recipient}`,
            senderAddress,
            ...(credentials.senderName
              ? { senderName: credentials.senderName }
              : {}),
            outboundSMSTextMessage: { message },
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new OrangeSmsError(
        response.status === 400
          ? "Orange rejected the sender or recipient configuration."
          : response.status === 402
            ? "The Orange SMS bundle has no available credit."
            : "Orange could not send the test message.",
        response.status,
      );
    }
    const data = (await response.json()) as {
      outboundSMSMessageRequest?: { resourceURL?: string };
    };
    const resourceUrl = data.outboundSMSMessageRequest?.resourceURL;
    return {
      providerMessageId: resourceUrl?.split("/").pop() || null,
    };
  } catch (error) {
    if (error instanceof OrangeSmsError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OrangeSmsError("Orange SMS delivery timed out.");
    }
    throw new OrangeSmsError("Could not connect to Orange.");
  } finally {
    clearTimeout(timeout);
  }
}