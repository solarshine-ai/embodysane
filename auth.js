import {
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
} from "/assets/vendor/netlify-identity.js";

const PRIVATE_KEYS = ["es_diary", "es_vault", "es_free_analyses", "es_daily_analyses"];
let currentUser = null;
let accountState = null;
let syncTimer = null;
let authMode = "login";

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const browserSnapshot = () => ({
  diary: readJson("es_diary", []),
  vault: readJson("es_vault", []),
  freeAnalyses: readJson("es_free_analyses", 2),
  dailyAnalyses: readJson("es_daily_analyses", { date: "", count: 0 }),
});

const uniqueRecords = (primary, secondary) => {
  const seen = new Set();
  return [...primary, ...secondary].filter((record) => {
    const key = JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeData = (serverData, localData) => {
  const serverDaily = serverData.dailyAnalyses || { date: "", count: 0 };
  const localDaily = localData.dailyAnalyses || { date: "", count: 0 };
  const dailyAnalyses =
    serverDaily.date === localDaily.date
      ? { date: serverDaily.date, count: Math.max(serverDaily.count || 0, localDaily.count || 0) }
      : serverDaily.date > localDaily.date
        ? serverDaily
        : localDaily;

  return {
    diary: uniqueRecords(serverData.diary || [], localData.diary || []),
    vault: uniqueRecords(serverData.vault || [], localData.vault || []),
    freeAnalyses: Math.min(serverData.freeAnalyses ?? 2, localData.freeAnalyses ?? 2),
    dailyAnalyses,
  };
};

const hasPersonalData = (data) =>
  data.diary.length > 0 ||
  data.vault.length > 0 ||
  data.freeAnalyses !== 2 ||
  Boolean(data.dailyAnalyses?.date);

/**
 * Caches the server's credit balance for display.
 *
 * Deliberately not written through PRIVATE_KEYS/localStorage as a source of
 * truth: the server decides what an account can afford, and every analyzer
 * response carries a fresh balance.
 */
const applyCreditState = (credits) => {
  window.esCredits = credits;
  window.updateAnalyzerBadge?.();
  window.updateHome?.();
};

const applyAccountState = (payload) => {
  accountState = payload;
  window.accountSyncPaused = true;
  writeJson("es_diary", payload.data.diary || []);
  writeJson("es_vault", payload.data.vault || []);
  writeJson("es_free_analyses", payload.data.freeAnalyses ?? 2);
  writeJson("es_daily_analyses", payload.data.dailyAnalyses || { date: "", count: 0 });
  writeJson("es_trial_start", payload.access.trialStartedAt);
  writeJson("es_founder_verified", payload.access.founderAccess === true);
  writeJson("es_subscribed", payload.access.subscriptionActive === true);
  window.accountSyncPaused = false;
  // Analyzer credits are authoritative on the server. This copy is only so the
  // badge can render without waiting on a request -- it is never trusted to
  // decide whether an analysis may run.
  if (payload.credits) applyCreditState(payload.credits);
  updateAuthUi();
};

const fetchAccount = async () => {
  const response = await fetch("/api/account", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Unable to load account");
  return response.json();
};

const saveAccount = async (data = browserSnapshot()) => {
  if (!currentUser) return null;
  const response = await fetch("/api/account", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data,
      trialStartedAt: readJson("es_trial_start", null),
    }),
  });
  if (!response.ok) throw new Error("Unable to save account data");
  return response.json();
};

const syncAccount = async () => {
  if (!currentUser) return;
  try {
    await saveAccount();
    setSyncStatus("Saved across devices", "#4cc9a8");
  } catch {
    setSyncStatus("Waiting to sync", "#c9a84c");
  }
};

const queueAccountSync = () => {
  if (!currentUser || window.accountSyncPaused) return;
  clearTimeout(syncTimer);
  setSyncStatus("Saving…", "#7a6f98");
  syncTimer = setTimeout(syncAccount, 650);
};

const hydrateAccount = async () => {
  if (!currentUser) return;
  const payload = await fetchAccount();
  const localData = browserSnapshot();
  const migrationKey = `es_account_migrated_${currentUser.id}`;
  const shouldImport = !localStorage.getItem(migrationKey) && hasPersonalData(localData);

  if (!payload.dataInitialized || shouldImport) {
    const merged = mergeData(payload.data, localData);
    await saveAccount(merged);
    localStorage.setItem(migrationKey, "true");
    payload.data = merged;
    payload.dataInitialized = true;
  }

  applyAccountState(payload);
};

const setMessage = (message, color = "#9d93b8") => {
  const element = document.getElementById("auth-message");
  if (!element) return;
  element.textContent = message;
  element.style.color = color;
  element.style.display = message ? "block" : "none";
};

const setSyncStatus = (message, color) => {
  const element = document.getElementById("account-sync-status");
  if (!element) return;
  element.textContent = message;
  element.style.color = color;
};

const setBusy = (busy) => {
  document.querySelectorAll("#auth-overlay button, #auth-overlay input").forEach((element) => {
    element.disabled = busy;
  });
};

const authErrorMessage = (error) => {
  if (error instanceof AuthError && error.status === 401) return "That email or password was not recognized.";
  if (error instanceof AuthError && error.status === 422) return "Check the email and password, then try again.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
};

const updateAuthUi = () => {
  const signedIn = Boolean(currentUser);
  const email = currentUser?.email || "";
  document.querySelectorAll("[data-account-email]").forEach((element) => {
    element.textContent = signedIn ? email : "Not signed in";
  });
  const accountButton = document.getElementById("account-button");
  if (accountButton) accountButton.textContent = signedIn ? "Account" : "Sign in";
  const signedOut = document.getElementById("account-signed-out");
  const signedInCard = document.getElementById("account-signed-in");
  if (signedOut) signedOut.style.display = signedIn ? "none" : "block";
  if (signedInCard) signedInCard.style.display = signedIn ? "block" : "none";
  if (signedIn && accountState) setSyncStatus("Saved across devices", "#4cc9a8");
};

const setAuthMode = (mode) => {
  authMode = mode;
  document.getElementById("auth-current-user").style.display = "none";
  document.querySelector(".auth-tabs").style.display = "grid";
  document.getElementById("auth-main-forms").style.display = "block";
  document.getElementById("auth-reset-form").style.display = "none";
  const signupMode = mode === "signup";
  document.getElementById("auth-tab-login")?.classList.toggle("active", !signupMode);
  document.getElementById("auth-tab-signup")?.classList.toggle("active", signupMode);
  const nameRow = document.getElementById("auth-name-row");
  if (nameRow) nameRow.style.display = signupMode ? "block" : "none";
  const passwordButton = document.getElementById("auth-password-submit");
  if (passwordButton) passwordButton.textContent = signupMode ? "Create Account" : "Sign In";
  const magicButton = document.getElementById("auth-magic-submit");
  if (magicButton) magicButton.textContent = signupMode ? "Create Account With Email Link" : "Email Me a Sign-In Link";
  const forgot = document.getElementById("auth-forgot");
  if (forgot) forgot.style.display = signupMode ? "none" : "inline-block";
  setMessage("");
};

const showAuthModal = (mode = "login", message = "") => {
  const overlay = document.getElementById("auth-overlay");
  overlay?.classList.add("active");
  overlay?.setAttribute("aria-hidden", "false");
  if (currentUser) {
    document.getElementById("auth-current-user").style.display = "block";
    document.querySelector(".auth-tabs").style.display = "none";
    document.getElementById("auth-main-forms").style.display = "none";
    document.getElementById("auth-reset-form").style.display = "none";
    updateAuthUi();
  } else {
    setAuthMode(mode);
  }
  if (message) setMessage(message, "#c9a84c");
  setTimeout(() => document.getElementById("auth-email")?.focus(), 50);
};

const closeAuthModal = () => {
  const overlay = document.getElementById("auth-overlay");
  overlay?.classList.remove("active");
  overlay?.setAttribute("aria-hidden", "true");
  setMessage("");
};

const afterLogin = async (user) => {
  currentUser = user;
  await hydrateAccount();
  updateAuthUi();
  closeAuthModal();
  window.updateHome?.();
  window.updateTrialBanner?.();
  window.updateSettings?.();
};

const submitPasswordAuth = async (event) => {
  event.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const name = document.getElementById("auth-name")?.value.trim();
  setBusy(true);
  setMessage(authMode === "signup" ? "Creating your account…" : "Signing you in…");
  try {
    if (authMode === "signup") {
      const user = await signup(email, password, name ? { full_name: name } : undefined);
      if (!user.emailVerified) {
        setMessage("Check your email to confirm your account, then return here to sign in.", "#4cc9a8");
        return;
      }
      await afterLogin(user);
    } else {
      await afterLogin(await login(email, password));
    }
  } catch (error) {
    setMessage(authErrorMessage(error), "#c94c6a");
  } finally {
    setBusy(false);
  }
};

const submitMagicLink = async (event) => {
  event.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  setBusy(true);
  setMessage("Preparing your secure email link…");
  try {
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to send sign-in link");
    localStorage.removeItem("es_password_reset_requested");
    setMessage("Check your email for a secure sign-in link. It works for new and returning accounts.", "#4cc9a8");
  } catch (error) {
    setMessage(authErrorMessage(error), "#c94c6a");
  } finally {
    setBusy(false);
  }
};

const sendPasswordReset = async () => {
  const email = document.getElementById("auth-email").value.trim();
  if (!email) {
    setMessage("Enter your email first.", "#c94c6a");
    return;
  }
  setBusy(true);
  try {
    await requestPasswordRecovery(email);
    localStorage.setItem("es_password_reset_requested", "true");
    setMessage("Check your email for the password reset link.", "#4cc9a8");
  } catch (error) {
    setMessage(authErrorMessage(error), "#c94c6a");
  } finally {
    setBusy(false);
  }
};

const showPasswordReset = () => {
  showAuthModal("login");
  document.getElementById("auth-current-user").style.display = "none";
  document.querySelector(".auth-tabs").style.display = "none";
  document.getElementById("auth-main-forms").style.display = "none";
  document.getElementById("auth-reset-form").style.display = "block";
  setMessage("Choose a new password for your account.", "#c9a84c");
};

const submitNewPassword = async (event) => {
  event.preventDefault();
  const password = document.getElementById("auth-new-password").value;
  setBusy(true);
  try {
    currentUser = await updateUser({ password });
    localStorage.removeItem("es_password_reset_requested");
    document.getElementById("auth-main-forms").style.display = "block";
    document.getElementById("auth-reset-form").style.display = "none";
    await afterLogin(currentUser);
  } catch (error) {
    setMessage(authErrorMessage(error), "#c94c6a");
  } finally {
    setBusy(false);
  }
};

const signOut = async () => {
  clearTimeout(syncTimer);
  await syncAccount();
  await logout();
  currentUser = null;
  accountState = null;
  window.accountSyncPaused = true;
  PRIVATE_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem("es_subscribed");
  localStorage.removeItem("es_founder_verified");
  localStorage.removeItem("es_stripe_session_id");
  window.accountSyncPaused = false;
  location.reload();
};

// Falls back to the Payment Link so a missing STRIPE_PRICE_ID, or any Stripe
// outage on session creation, never leaves the subscribe button dead.
const openPaymentLinkFallback = () => {
  const url = new URL(window.STRIPE_LINK, window.location.href);
  url.searchParams.set("prefilled_email", currentUser.email);
  url.searchParams.set("client_reference_id", currentUser.id);
  window.open(url.toString(), "_blank", "noopener");
};

const openStripeCheckout = async () => {
  if (!currentUser?.email) {
    showAuthModal("signup", "Create or sign in to an account before subscribing, so access follows you across devices.");
    return;
  }
  // Stripe must be reached from a user gesture or the popup gets blocked, so the
  // tab is opened synchronously and navigated once the session URL comes back.
  const tab = window.open("", "_blank", "noopener");
  try {
    const response = await fetch("/api/create-checkout", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.url) {
      if (tab) tab.location = data.url;
      else window.location.assign(data.url);
      return;
    }
    if (response.status === 401) {
      tab?.close();
      showAuthModal("login", "Sign in again to continue to checkout.");
      return;
    }
    throw new Error(data.error || `Checkout unavailable (${response.status})`);
  } catch (error) {
    console.error("Falling back to the Stripe Payment Link.", error);
    tab?.close();
    openPaymentLinkFallback();
  }
};

const clearRemoteAccountData = async () => {
  if (!currentUser) return;
  const response = await fetch("/api/account", { method: "DELETE" });
  if (!response.ok) throw new Error("Unable to clear account data");
};

const refreshAccount = async () => {
  if (!currentUser) return null;
  const payload = await fetchAccount();
  applyAccountState(payload);
  return payload;
};

const initializeAuth = async () => {
  try {
    const callback = await handleAuthCallback();
    currentUser = callback?.user || (await getUser());
    if (currentUser) await hydrateAccount();
    if (callback?.type === "recovery" && localStorage.getItem("es_password_reset_requested")) {
      showPasswordReset();
    } else if (callback?.type === "recovery") {
      setTimeout(() => showAuthModal("login", "Your email link signed you in successfully."), 0);
    } else if (callback?.type === "confirmation") {
      setTimeout(() => showAuthModal("login", "Your email is confirmed and you are signed in."), 0);
    }
  } catch (error) {
    console.error("Account initialization failed.", error);
  }
  updateAuthUi();
  return currentUser;
};

window.showAuthModal = showAuthModal;
window.closeAuthModal = closeAuthModal;
window.setAuthMode = setAuthMode;
window.submitPasswordAuth = submitPasswordAuth;
window.submitMagicLink = submitMagicLink;
window.sendPasswordReset = sendPasswordReset;
window.showPasswordReset = showPasswordReset;
window.submitNewPassword = submitNewPassword;
window.signOut = signOut;
window.openStripeCheckout = openStripeCheckout;
window.queueAccountSync = queueAccountSync;
window.clearRemoteAccountData = clearRemoteAccountData;
window.refreshAccount = refreshAccount;
window.applyCreditState = applyCreditState;
window.getCurrentAccountUser = () => currentUser;
window.authReady = initializeAuth();

onAuthChange((event, user) => {
  if (event === "logout") {
    currentUser = null;
    accountState = null;
    updateAuthUi();
  } else if (user) {
    currentUser = user;
    hydrateAccount().catch(() => {});
  }
});
