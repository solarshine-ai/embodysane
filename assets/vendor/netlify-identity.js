var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/types.ts
var AUTH_PROVIDERS = ["google", "github", "gitlab", "bitbucket", "facebook", "email"];

// src/environment.ts
import GoTrue from "gotrue-js";

// src/errors.ts
var AuthError = class _AuthError extends Error {
  constructor(message, status, options) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
  static from(error) {
    if (error instanceof _AuthError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new _AuthError(message, void 0, { cause: error });
  }
};
var MissingIdentityError = class extends Error {
  constructor(message = "Netlify Identity is not available.") {
    super(message);
    this.name = "MissingIdentityError";
  }
};

// src/environment.ts
var IDENTITY_PATH = "/.netlify/identity";
var goTrueClient = null;
var cachedApiUrl;
var warnedMissingUrl = false;
var isBrowser = () => typeof window !== "undefined" && typeof window.location !== "undefined";
var discoverApiUrl = () => {
  if (cachedApiUrl !== void 0) return cachedApiUrl;
  if (isBrowser()) {
    cachedApiUrl = `${window.location.origin}${IDENTITY_PATH}`;
  } else {
    const identityContext = getIdentityContext();
    if (identityContext?.url) {
      cachedApiUrl = identityContext.url;
    } else if (globalThis.Netlify?.context?.url) {
      cachedApiUrl = new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href;
    } else if (typeof process !== "undefined" && process.env?.URL) {
      cachedApiUrl = new URL(IDENTITY_PATH, process.env.URL).href;
    }
  }
  return cachedApiUrl ?? null;
};
var getGoTrueClient = () => {
  if (goTrueClient) return goTrueClient;
  const apiUrl = discoverApiUrl();
  if (!apiUrl) {
    if (!warnedMissingUrl) {
      console.warn(
        "@netlify/identity: Could not determine the Identity endpoint URL. Make sure your site has Netlify Identity enabled, or run your app with `netlify dev`."
      );
      warnedMissingUrl = true;
    }
    return null;
  }
  goTrueClient = new GoTrue({ APIUrl: apiUrl, setCookie: false });
  return goTrueClient;
};
var getClient = () => {
  const client = getGoTrueClient();
  if (!client) throw new MissingIdentityError();
  return client;
};
var getIdentityContext = () => {
  const identityContext = globalThis.netlifyIdentityContext;
  if (identityContext?.url) {
    return {
      url: identityContext.url,
      token: identityContext.token
    };
  }
  if (globalThis.Netlify?.context?.url) {
    return { url: new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href };
  }
  const siteUrl = typeof process !== "undefined" ? process.env?.URL : void 0;
  if (siteUrl) {
    return { url: new URL(IDENTITY_PATH, siteUrl).href };
  }
  return null;
};

// src/cookies.ts
var NF_JWT_COOKIE = "nf_jwt";
var NF_REFRESH_COOKIE = "nf_refresh";
var getCookie = (name) => {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`).exec(document.cookie);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};
var setAuthCookies = (cookies, accessToken, refreshToken) => {
  cookies.set({
    name: NF_JWT_COOKIE,
    value: accessToken,
    httpOnly: false,
    secure: true,
    path: "/",
    sameSite: "Lax"
  });
  if (refreshToken) {
    cookies.set({
      name: NF_REFRESH_COOKIE,
      value: refreshToken,
      httpOnly: false,
      secure: true,
      path: "/",
      sameSite: "Lax"
    });
  }
};
var deleteAuthCookies = (cookies) => {
  cookies.delete(NF_JWT_COOKIE);
  cookies.delete(NF_REFRESH_COOKIE);
};
var setBrowserAuthCookies = (accessToken, refreshToken) => {
  if (typeof document === "undefined") return;
  document.cookie = `${NF_JWT_COOKIE}=${encodeURIComponent(accessToken)}; path=/; secure; samesite=lax`;
  if (refreshToken) {
    document.cookie = `${NF_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; path=/; secure; samesite=lax`;
  }
};
var deleteBrowserAuthCookies = () => {
  if (typeof document === "undefined") return;
  document.cookie = `${NF_JWT_COOKIE}=; path=/; secure; samesite=lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  document.cookie = `${NF_REFRESH_COOKIE}=; path=/; secure; samesite=lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};
var getServerCookie = (name) => {
  const cookies = globalThis.Netlify?.context?.cookies;
  if (!cookies || typeof cookies.get !== "function") return null;
  return cookies.get(name) ?? null;
};

// src/nextjs.ts
var nextHeadersFn;
var triggerNextjsDynamic = () => {
  if (nextHeadersFn === null) return;
  if (nextHeadersFn === void 0) {
    try {
      if (typeof __require === "undefined") {
        nextHeadersFn = null;
        return;
      }
      const mod = __require("next/headers");
      nextHeadersFn = mod.headers;
    } catch {
      nextHeadersFn = null;
      return;
    }
  }
  const fn = nextHeadersFn;
  if (!fn) return;
  try {
    fn();
  } catch (e) {
    if (e instanceof Error && ("digest" in e || /bail\s*out.*prerende/i.test(e.message))) {
      throw e;
    }
  }
};

// src/fetch.ts
var DEFAULT_TIMEOUT_MS = 5e3;
var fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const pathname = new URL(url).pathname;
      throw new AuthError(`Identity request to ${pathname} timed out after ${String(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

// src/events.ts
var AUTH_EVENTS = {
  LOGIN: "login",
  LOGOUT: "logout",
  TOKEN_REFRESH: "token_refresh",
  USER_UPDATED: "user_updated",
  RECOVERY: "recovery"
};
var GOTRUE_STORAGE_KEY = "gotrue.user";
var listeners = /* @__PURE__ */ new Set();
var emitAuthEvent = (event, user) => {
  for (const listener of listeners) {
    try {
      listener(event, user);
    } catch {
    }
  }
};
var storageListenerAttached = false;
var attachStorageListener = () => {
  if (storageListenerAttached || !isBrowser()) return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== GOTRUE_STORAGE_KEY) return;
    if (event.newValue) {
      const client = getGoTrueClient();
      const currentUser = client?.currentUser();
      emitAuthEvent(AUTH_EVENTS.LOGIN, currentUser ? toUser(currentUser) : null);
    } else {
      emitAuthEvent(AUTH_EVENTS.LOGOUT, null);
    }
  });
};
var onAuthChange = (callback) => {
  if (!isBrowser()) {
    return () => {
    };
  }
  listeners.add(callback);
  attachStorageListener();
  return () => {
    listeners.delete(callback);
  };
};

// src/refresh.ts
var REFRESH_MARGIN_S = 60;
var refreshTimer = null;
var startTokenRefresh = () => {
  if (!isBrowser()) return;
  stopTokenRefresh();
  const client = getGoTrueClient();
  const user = client?.currentUser();
  if (!user) return;
  const token = user.tokenDetails();
  if (!token?.expires_at) return;
  const nowS = Math.floor(Date.now() / 1e3);
  const expiresAtS = typeof token.expires_at === "number" && token.expires_at > 1e12 ? Math.floor(token.expires_at / 1e3) : token.expires_at;
  const delayMs = Math.max(0, expiresAtS - nowS - REFRESH_MARGIN_S) * 1e3;
  refreshTimer = setTimeout(() => {
    void (async () => {
      try {
        const freshJwt = await user.jwt(true);
        const freshDetails = user.tokenDetails();
        setBrowserAuthCookies(freshJwt, freshDetails?.refresh_token);
        emitAuthEvent(AUTH_EVENTS.TOKEN_REFRESH, toUser(user));
        startTokenRefresh();
      } catch {
        stopTokenRefresh();
      }
    })();
  }, delayMs);
};
var stopTokenRefresh = () => {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
};
var refreshSession = async () => {
  if (isBrowser()) {
    const client = getGoTrueClient();
    const user = client?.currentUser();
    if (!user) return null;
    const details = user.tokenDetails();
    if (details?.expires_at) {
      const nowS2 = Math.floor(Date.now() / 1e3);
      const expiresAtS = typeof details.expires_at === "number" && details.expires_at > 1e12 ? Math.floor(details.expires_at / 1e3) : details.expires_at;
      if (expiresAtS - nowS2 > REFRESH_MARGIN_S) {
        return null;
      }
    }
    try {
      const jwt = await user.jwt(true);
      setBrowserAuthCookies(jwt, user.tokenDetails()?.refresh_token);
      emitAuthEvent(AUTH_EVENTS.TOKEN_REFRESH, toUser(user));
      startTokenRefresh();
      return jwt;
    } catch {
      stopTokenRefresh();
      return null;
    }
  }
  const accessToken = getServerCookie(NF_JWT_COOKIE);
  const refreshToken = getServerCookie(NF_REFRESH_COOKIE);
  if (!accessToken || !refreshToken) return null;
  const decoded = decodeJwtPayload(accessToken);
  if (!decoded?.exp) return null;
  const nowS = Math.floor(Date.now() / 1e3);
  if (decoded.exp - nowS > REFRESH_MARGIN_S) {
    return null;
  }
  const ctx = getIdentityContext();
  const identityUrl = ctx?.url ?? (globalThis.Netlify?.context?.url ? new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href : null);
  if (!identityUrl) {
    throw new AuthError("Could not determine the Identity endpoint URL for token refresh");
  }
  let res;
  try {
    res = await fetchWithTimeout(`${identityUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString()
    });
  } catch (error) {
    throw AuthError.from(error);
  }
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 400) {
      const cookies2 = globalThis.Netlify?.context?.cookies;
      if (cookies2) {
        deleteAuthCookies(cookies2);
      }
      return null;
    }
    throw new AuthError(errorBody.msg ?? `Token refresh failed (${String(res.status)})`, res.status);
  }
  const data = await res.json();
  const cookies = globalThis.Netlify?.context?.cookies;
  if (cookies) {
    setAuthCookies(cookies, data.access_token, data.refresh_token);
  }
  return data.access_token;
};

// src/auth.ts
var getCookies = () => {
  const cookies = globalThis.Netlify?.context?.cookies;
  if (!cookies) {
    throw new AuthError("Server-side auth requires Netlify Functions runtime");
  }
  return cookies;
};
var getServerIdentityUrl = () => {
  const ctx = getIdentityContext();
  if (!ctx?.url) {
    throw new AuthError("Could not determine the Identity endpoint URL on the server");
  }
  return ctx.url;
};
var persistSession = true;
var login = async (email, password) => {
  if (!isBrowser()) {
    const identityUrl = getServerIdentityUrl();
    const cookies = getCookies();
    const body = new URLSearchParams({
      grant_type: "password",
      username: email,
      password
    });
    let res;
    try {
      res = await fetchWithTimeout(`${identityUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
    } catch (error) {
      throw AuthError.from(error);
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new AuthError(
        errorBody.msg ?? errorBody.error_description ?? `Login failed (${String(res.status)})`,
        res.status
      );
    }
    const data = await res.json();
    const accessToken = data.access_token;
    let userRes;
    try {
      userRes = await fetchWithTimeout(`${identityUrl}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (error) {
      throw AuthError.from(error);
    }
    if (!userRes.ok) {
      const errorBody = await userRes.json().catch(() => ({}));
      throw new AuthError(errorBody.msg ?? `Failed to fetch user data (${String(userRes.status)})`, userRes.status);
    }
    const userData = await userRes.json();
    const user = toUser(userData);
    setAuthCookies(cookies, accessToken, data.refresh_token);
    return user;
  }
  const client = getClient();
  try {
    const gotrueUser = await client.login(email, password, persistSession);
    const jwt = await gotrueUser.jwt();
    setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};
var signup = async (email, password, data) => {
  if (!isBrowser()) {
    const identityUrl = getServerIdentityUrl();
    const cookies = getCookies();
    let res;
    try {
      res = await fetchWithTimeout(`${identityUrl}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, data })
      });
    } catch (error) {
      throw AuthError.from(error);
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new AuthError(errorBody.msg ?? `Signup failed (${String(res.status)})`, res.status);
    }
    const responseData = await res.json();
    const user = toUser(responseData);
    if (responseData.confirmed_at) {
      const accessToken = responseData.access_token;
      if (accessToken) {
        setAuthCookies(cookies, accessToken, responseData.refresh_token);
      }
    }
    return user;
  }
  const client = getClient();
  try {
    const response = await client.signup(email, password, data);
    const user = toUser(response);
    if (response.confirmed_at) {
      const jwt = await response.jwt?.();
      if (jwt) {
        const refreshToken = response.tokenDetails?.()?.refresh_token;
        setBrowserAuthCookies(jwt, refreshToken);
      }
      startTokenRefresh();
      emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    }
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};
var logout = async () => {
  if (!isBrowser()) {
    const identityUrl = getServerIdentityUrl();
    const cookies = getCookies();
    const jwt = cookies.get(NF_JWT_COOKIE);
    if (jwt) {
      try {
        await fetchWithTimeout(`${identityUrl}/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` }
        });
      } catch {
      }
    }
    deleteAuthCookies(cookies);
    return;
  }
  const client = getClient();
  try {
    const currentUser = client.currentUser();
    if (currentUser) {
      await currentUser.logout();
    }
    deleteBrowserAuthCookies();
    stopTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGOUT, null);
  } catch (error) {
    throw AuthError.from(error);
  }
};
var oauthLogin = (provider) => {
  if (!isBrowser()) {
    throw new AuthError("oauthLogin() is only available in the browser");
  }
  const client = getClient();
  window.location.href = client.loginExternalUrl(provider);
  throw new AuthError("Redirecting to OAuth provider");
};
var handleAuthCallback = async () => {
  if (!isBrowser()) return null;
  const hash = window.location.hash.substring(1);
  if (!hash) return null;
  const client = getClient();
  const params = new URLSearchParams(hash);
  try {
    const accessToken = params.get("access_token");
    if (accessToken) return await handleOAuthCallback(client, params, accessToken);
    const confirmationToken = params.get("confirmation_token");
    if (confirmationToken) return await handleConfirmationCallback(client, confirmationToken);
    const recoveryToken = params.get("recovery_token");
    if (recoveryToken) return await handleRecoveryCallback(client, recoveryToken);
    const inviteToken = params.get("invite_token");
    if (inviteToken) return handleInviteCallback(inviteToken);
    const emailChangeToken = params.get("email_change_token");
    if (emailChangeToken) return await handleEmailChangeCallback(client, emailChangeToken);
    return null;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw AuthError.from(error);
  }
};
var handleOAuthCallback = async (client, params, accessToken) => {
  const refreshToken = params.get("refresh_token") ?? "";
  const expiresIn = parseInt(params.get("expires_in") ?? "", 10);
  const expiresAt = parseInt(params.get("expires_at") ?? "", 10);
  const gotrueUser = await client.createUser(
    {
      access_token: accessToken,
      token_type: params.get("token_type") ?? "bearer",
      expires_in: isFinite(expiresIn) ? expiresIn : 3600,
      expires_at: isFinite(expiresAt) ? expiresAt : Math.floor(Date.now() / 1e3) + 3600,
      refresh_token: refreshToken
    },
    persistSession
  );
  setBrowserAuthCookies(accessToken, refreshToken || void 0);
  const user = toUser(gotrueUser);
  startTokenRefresh();
  clearHash();
  emitAuthEvent(AUTH_EVENTS.LOGIN, user);
  return { type: "oauth", user };
};
var handleConfirmationCallback = async (client, token) => {
  const gotrueUser = await client.confirm(token, persistSession);
  const jwt = await gotrueUser.jwt();
  setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
  const user = toUser(gotrueUser);
  startTokenRefresh();
  clearHash();
  emitAuthEvent(AUTH_EVENTS.LOGIN, user);
  return { type: "confirmation", user };
};
var handleRecoveryCallback = async (client, token) => {
  const gotrueUser = await client.recover(token, persistSession);
  const jwt = await gotrueUser.jwt();
  setBrowserAuthCookies(jwt, gotrueUser.tokenDetails()?.refresh_token);
  const user = toUser(gotrueUser);
  startTokenRefresh();
  clearHash();
  emitAuthEvent(AUTH_EVENTS.RECOVERY, user);
  return { type: "recovery", user };
};
var handleInviteCallback = (token) => {
  clearHash();
  return { type: "invite", user: null, token };
};
var handleEmailChangeCallback = async (client, emailChangeToken) => {
  const currentUser = client.currentUser();
  if (!currentUser) {
    throw new AuthError("Email change verification requires an active browser session");
  }
  const jwt = await currentUser.jwt();
  const identityUrl = `${window.location.origin}${IDENTITY_PATH}`;
  const emailChangeRes = await fetch(`${identityUrl}/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ email_change_token: emailChangeToken })
  });
  if (!emailChangeRes.ok) {
    const errorBody = await emailChangeRes.json().catch(() => ({}));
    throw new AuthError(
      errorBody.msg ?? `Email change verification failed (${String(emailChangeRes.status)})`,
      emailChangeRes.status
    );
  }
  const emailChangeData = await emailChangeRes.json();
  const user = toUser(emailChangeData);
  clearHash();
  emitAuthEvent(AUTH_EVENTS.USER_UPDATED, user);
  return { type: "email_change", user };
};
var clearHash = () => {
  history.replaceState(null, "", window.location.pathname + window.location.search);
};
var hydrateSession = async () => {
  if (!isBrowser()) return null;
  const client = getClient();
  const currentUser = client.currentUser();
  if (currentUser) {
    startTokenRefresh();
    return toUser(currentUser);
  }
  const accessToken = getCookie(NF_JWT_COOKIE);
  if (!accessToken) return null;
  const refreshToken = getCookie(NF_REFRESH_COOKIE) ?? "";
  const decoded = decodeJwtPayload(accessToken);
  const expiresAt = decoded?.exp ?? Math.floor(Date.now() / 1e3) + 3600;
  const expiresIn = Math.max(0, expiresAt - Math.floor(Date.now() / 1e3));
  let gotrueUser;
  try {
    gotrueUser = await client.createUser(
      {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token: refreshToken
      },
      persistSession
    );
  } catch {
    deleteBrowserAuthCookies();
    return null;
  }
  const user = toUser(gotrueUser);
  startTokenRefresh();
  emitAuthEvent(AUTH_EVENTS.LOGIN, user);
  return user;
};

// src/user.ts
var toAuthProvider = (value) => typeof value === "string" && AUTH_PROVIDERS.includes(value) ? value : void 0;
var toOptionalString = (value) => typeof value === "string" && value !== "" ? value : void 0;
var toRoles = (appMeta) => {
  const roles = appMeta.roles;
  if (Array.isArray(roles) && roles.every((r) => typeof r === "string")) {
    return roles;
  }
  return void 0;
};
var toUser = (userData) => {
  const userMeta = userData.user_metadata ?? {};
  const appMeta = userData.app_metadata ?? {};
  const name = userMeta.full_name ?? userMeta.name;
  const pictureUrl = userMeta.avatar_url;
  return {
    id: userData.id,
    email: userData.email,
    confirmedAt: toOptionalString(userData.confirmed_at),
    createdAt: userData.created_at,
    updatedAt: userData.updated_at,
    role: toOptionalString(userData.role),
    provider: toAuthProvider(appMeta.provider),
    name: typeof name === "string" ? name : void 0,
    pictureUrl: typeof pictureUrl === "string" ? pictureUrl : void 0,
    roles: toRoles(appMeta),
    invitedAt: toOptionalString(userData.invited_at),
    confirmationSentAt: toOptionalString(userData.confirmation_sent_at),
    recoverySentAt: toOptionalString(userData.recovery_sent_at),
    pendingEmail: toOptionalString(userData.new_email),
    emailChangeSentAt: toOptionalString(userData.email_change_sent_at),
    lastSignInAt: toOptionalString(userData.last_sign_in_at),
    userMetadata: userMeta,
    appMetadata: appMeta
  };
};
var claimsToUser = (claims) => {
  const appMeta = claims.app_metadata ?? {};
  const userMeta = claims.user_metadata ?? {};
  const name = userMeta.full_name ?? userMeta.name;
  const pictureUrl = userMeta.avatar_url;
  return {
    id: claims.sub ?? "",
    email: claims.email,
    provider: toAuthProvider(appMeta.provider),
    name: typeof name === "string" ? name : void 0,
    pictureUrl: typeof pictureUrl === "string" ? pictureUrl : void 0,
    roles: toRoles(appMeta),
    userMetadata: userMeta,
    appMetadata: appMeta
  };
};
var decodeJwtPayload = (token) => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload);
  } catch {
    return null;
  }
};
var fetchFullUser = async (identityUrl, jwt) => {
  try {
    const res = await fetchWithTimeout(`${identityUrl}/user`, {
      headers: { Authorization: `Bearer ${jwt}` }
    });
    if (!res.ok) return null;
    const userData = await res.json();
    return toUser(userData);
  } catch {
    return null;
  }
};
var resolveIdentityUrl = () => {
  const identityContext = getIdentityContext();
  if (identityContext?.url) return identityContext.url;
  if (globalThis.Netlify?.context?.url) {
    return new URL(IDENTITY_PATH, globalThis.Netlify.context.url).href;
  }
  const siteUrl = typeof process !== "undefined" ? process.env?.URL : void 0;
  if (siteUrl) {
    return new URL(IDENTITY_PATH, siteUrl).href;
  }
  return null;
};
var getUser = async () => {
  if (isBrowser()) {
    const client = getGoTrueClient();
    const currentUser = client?.currentUser() ?? null;
    if (currentUser) {
      const jwt2 = getCookie(NF_JWT_COOKIE);
      if (!jwt2) {
        try {
          currentUser.clearSession();
        } catch {
        }
        return null;
      }
      startTokenRefresh();
      return toUser(currentUser);
    }
    const jwt = getCookie(NF_JWT_COOKIE);
    if (!jwt) return null;
    const claims2 = decodeJwtPayload(jwt);
    if (!claims2) return null;
    const hydrated = await hydrateSession();
    return hydrated ?? null;
  }
  triggerNextjsDynamic();
  const identityContext = globalThis.netlifyIdentityContext;
  const serverJwt = identityContext?.token ?? getServerCookie(NF_JWT_COOKIE);
  if (serverJwt) {
    const identityUrl = resolveIdentityUrl();
    if (identityUrl) {
      const fullUser = await fetchFullUser(identityUrl, serverJwt);
      if (fullUser) return fullUser;
    }
  }
  const claims = identityContext?.user ?? null;
  return claims ? claimsToUser(claims) : null;
};
var isAuthenticated = async () => await getUser() !== null;

// src/config.ts
var getIdentityConfig = () => {
  if (isBrowser()) {
    return { url: `${window.location.origin}${IDENTITY_PATH}` };
  }
  return getIdentityContext();
};
var getSettings = async () => {
  const client = getClient();
  try {
    const raw = await client.settings();
    const external = raw.external ?? {};
    return {
      autoconfirm: raw.autoconfirm,
      disableSignup: raw.disable_signup,
      providers: {
        google: external.google ?? false,
        github: external.github ?? false,
        gitlab: external.gitlab ?? false,
        bitbucket: external.bitbucket ?? false,
        facebook: external.facebook ?? false,
        email: external.email ?? false
      }
    };
  } catch (err) {
    throw new AuthError(err instanceof Error ? err.message : "Failed to fetch identity settings", 502, { cause: err });
  }
};

// src/csrf.ts
var verifyRequestOrigin = (request, options) => {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AuthError("Cross-origin request refused: missing Origin header.", 403);
  }
  const allowed = options?.allowedOrigins ?? [new URL(request.url).origin];
  if (!allowed.includes(origin)) {
    throw new AuthError(`Cross-origin request refused: Origin ${origin} did not match an allowed origin.`, 403);
  }
};

// src/account.ts
var resolveCurrentUser = async () => {
  const client = getClient();
  let currentUser = client.currentUser();
  if (!currentUser && isBrowser()) {
    try {
      await hydrateSession();
    } catch {
    }
    currentUser = client.currentUser();
  }
  if (!currentUser) throw new AuthError("No user is currently logged in");
  return currentUser;
};
var requestPasswordRecovery = async (email) => {
  const client = getClient();
  try {
    await client.requestPasswordRecovery(email);
  } catch (error) {
    throw AuthError.from(error);
  }
};
var recoverPassword = async (token, newPassword) => {
  const client = getClient();
  try {
    const gotrueUser = await client.recover(token, persistSession);
    const updatedUser = await gotrueUser.update({ password: newPassword });
    const user = toUser(updatedUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};
var confirmEmail = async (token) => {
  const client = getClient();
  try {
    const gotrueUser = await client.confirm(token, persistSession);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};
var acceptInvite = async (token, password) => {
  const client = getClient();
  try {
    const gotrueUser = await client.acceptInvite(token, password, persistSession);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};
var verifyEmailChange = async (token) => {
  if (!isBrowser()) throw new AuthError("verifyEmailChange() is only available in the browser");
  const currentUser = await resolveCurrentUser();
  try {
    const jwt = await currentUser.jwt();
    const identityUrl = `${window.location.origin}${IDENTITY_PATH}`;
    const res = await fetch(`${identityUrl}/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({ email_change_token: token })
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new AuthError(errorBody.msg ?? `Email change verification failed (${String(res.status)})`, res.status);
    }
    const userData = await res.json();
    const user = toUser(userData);
    emitAuthEvent(AUTH_EVENTS.USER_UPDATED, user);
    return user;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw AuthError.from(error);
  }
};
var updateUser = async (updates) => {
  const currentUser = await resolveCurrentUser();
  try {
    const updatedUser = await currentUser.update(updates);
    const user = toUser(updatedUser);
    emitAuthEvent(AUTH_EVENTS.USER_UPDATED, user);
    return user;
  } catch (error) {
    throw AuthError.from(error);
  }
};

// src/admin.ts
var SERVER_ONLY_MESSAGE = "Admin operations are server-only. Call admin methods from a Netlify Function or Edge Function, not from browser code.";
var sanitizeUserId = (userId) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    throw new AuthError("User ID is not a valid UUID");
  }
  return encodeURIComponent(userId);
};
var assertServer = () => {
  if (isBrowser()) {
    throw new AuthError(SERVER_ONLY_MESSAGE);
  }
};
var getAdminAuth = () => {
  const ctx = getIdentityContext();
  if (!ctx?.url) {
    throw new AuthError("Could not determine the Identity endpoint URL on the server");
  }
  if (!ctx.token) {
    throw new AuthError("Admin operations require an operator token (only available in Netlify Functions)");
  }
  return { url: ctx.url, token: ctx.token };
};
var adminFetch = async (path, options = {}) => {
  const { url, token } = getAdminAuth();
  let res;
  try {
    res = await fetchWithTimeout(`${url}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    throw new AuthError(error.message, void 0, { cause: error });
  }
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new AuthError(
      errorBody.msg ?? `Admin request failed (${String(res.status)})`,
      res.status
    );
  }
  return res;
};
var listUsers = async (options) => {
  assertServer();
  const params = new URLSearchParams();
  if (options?.page != null) params.set("page", String(options.page));
  if (options?.perPage != null) params.set("per_page", String(options.perPage));
  const query = params.toString();
  const path = `/admin/users${query ? `?${query}` : ""}`;
  const res = await adminFetch(path);
  const body = await res.json();
  return body.users.map(toUser);
};
var getUser2 = async (userId) => {
  assertServer();
  const sanitizedUserId = sanitizeUserId(userId);
  const res = await adminFetch(`/admin/users/${sanitizedUserId}`);
  const userData = await res.json();
  return toUser(userData);
};
var createUser = async (params) => {
  assertServer();
  const body = {
    email: params.email,
    password: params.password,
    confirm: true
  };
  if (params.data) {
    const allowedKeys = ["role", "app_metadata", "user_metadata"];
    for (const key of allowedKeys) {
      if (key in params.data) {
        body[key] = params.data[key];
      }
    }
  }
  const res = await adminFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const userData = await res.json();
  return toUser(userData);
};
var updateUser2 = async (userId, attributes) => {
  assertServer();
  const sanitizedUserId = sanitizeUserId(userId);
  const body = {};
  const allowedKeys = ["email", "password", "role", "confirm", "app_metadata", "user_metadata"];
  for (const key of allowedKeys) {
    if (key in attributes) {
      body[key] = attributes[key];
    }
  }
  const res = await adminFetch(`/admin/users/${sanitizedUserId}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  const userData = await res.json();
  return toUser(userData);
};
var deleteUser = async (userId) => {
  assertServer();
  const sanitizedUserId = sanitizeUserId(userId);
  await adminFetch(`/admin/users/${sanitizedUserId}`, { method: "DELETE" });
};
var admin = { listUsers, getUser: getUser2, createUser, updateUser: updateUser2, deleteUser };
export {
  AUTH_EVENTS,
  AuthError,
  MissingIdentityError,
  acceptInvite,
  admin,
  confirmEmail,
  getIdentityConfig,
  getSettings,
  getUser,
  handleAuthCallback,
  hydrateSession,
  isAuthenticated,
  login,
  logout,
  oauthLogin,
  onAuthChange,
  recoverPassword,
  refreshSession,
  requestPasswordRecovery,
  signup,
  updateUser,
  verifyEmailChange,
  verifyRequestOrigin
};
