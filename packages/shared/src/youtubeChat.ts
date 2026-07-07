export type YoutubeChatMode = "off" | "dry-run" | "live";

export type YoutubeChatMessageKind = "new_event" | "manual_test" | "promotional_like";

export type YoutubeChatMessageStatus = "pending" | "posted" | "skipped" | "failed";

export type YoutubeChatSkipReason =
  | "duplicate_event"
  | "stale_event"
  | "stale_queue"
  | "no_active_broadcast"
  | "chat_disabled"
  | "rate_limited"
  | "queue_overflow"
  | "manual_off"
  | "api_error";

export type YoutubeChatCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  channelId?: string | null;
};

export type ResolvedYoutubeLiveChat = {
  accessToken: string;
  channelId: string | null;
  activeBroadcastId: string | null;
  liveChatId: string | null;
};

type TokenResponse = {
  access_token?: string;
};

type LiveBroadcastItem = {
  id?: string;
  snippet?: {
    liveChatId?: string;
  };
};

type LiveBroadcastsResponse = {
  items?: LiveBroadcastItem[];
};

type InsertMessageResponse = {
  id?: string;
};

type GoogleApiErrorResponse = {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

export class YoutubeApiError extends Error {
  status: number;
  reason: string | null;

  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = "YoutubeApiError";
    this.status = status;
    this.reason = reason;
  }
}

export function hasYoutubeChatCredentials(
  credentials: Partial<YoutubeChatCredentials> | null | undefined
): credentials is YoutubeChatCredentials {
  return Boolean(
    credentials?.clientId?.trim() && credentials.clientSecret?.trim() && credentials.refreshToken?.trim()
  );
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

async function parseGoogleApiError(response: Response): Promise<YoutubeApiError> {
  const payload = await readJson<GoogleApiErrorResponse>(response).catch(() => null);
  const reason = payload?.error?.errors?.[0]?.reason ?? null;
  const message =
    payload?.error?.message ??
    payload?.error?.errors?.[0]?.message ??
    `YouTube API request failed with status ${response.status}`;
  return new YoutubeApiError(message, response.status, reason);
}

async function exchangeRefreshToken(
  credentials: YoutubeChatCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw await parseGoogleApiError(response);
  }

  const payload = await readJson<TokenResponse>(response);
  if (!payload?.access_token) {
    throw new YoutubeApiError("Google OAuth token response did not include access_token", 502);
  }
  return payload.access_token;
}

export async function resolveYoutubeLiveChat(
  credentials: YoutubeChatCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedYoutubeLiveChat> {
  const accessToken = await exchangeRefreshToken(credentials, fetchImpl);
  const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
  url.searchParams.set("part", "id,snippet,status");
  url.searchParams.set("mine", "true");
  url.searchParams.set("broadcastStatus", "active");
  url.searchParams.set("broadcastType", "all");
  url.searchParams.set("maxResults", "5");

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw await parseGoogleApiError(response);
  }

  const payload = (await readJson<LiveBroadcastsResponse>(response)) ?? {};
  const active = payload.items?.find((item) => item.snippet?.liveChatId) ?? payload.items?.[0] ?? null;

  return {
    accessToken,
    channelId: credentials.channelId ?? null,
    activeBroadcastId: active?.id ?? null,
    liveChatId: active?.snippet?.liveChatId ?? null
  };
}

export async function insertYoutubeLiveChatMessage(
  liveChat: Pick<ResolvedYoutubeLiveChat, "accessToken" | "liveChatId">,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ messageId: string | null }> {
  if (!liveChat.liveChatId) {
    throw new YoutubeApiError("No active liveChatId available", 409, "chat_disabled");
  }

  const response = await fetchImpl(
    "https://www.googleapis.com/youtube/v3/liveChat/messages?part=id,snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${liveChat.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          liveChatId: liveChat.liveChatId,
          type: "textMessageEvent",
          textMessageDetails: {
            messageText: text
          }
        }
      })
    }
  );

  if (!response.ok) {
    throw await parseGoogleApiError(response);
  }

  const payload = await readJson<InsertMessageResponse>(response);
  return { messageId: payload?.id ?? null };
}
