// Netlify serverless function — handles the redirect LINE sends back after
// a customer approves "LINEアカウントと連携する". This is the only place
// that ever sees the LINE Login Channel Secret, and the only place that
// writes accounts/{customerId}/lineUserId.
//
// Flow: customer clicks the link button on their own PicoPay page (which
// already knows their customerId) → LINE's authorize screen → LINE
// redirects here with ?code=...&state=<customerId> → we exchange the code
// for an access token, fetch the LINE profile to get the real LINE userId,
// and save it against that customer's account. Because `state` originated
// from the customer's own already-identified page, this is what ties a
// specific LINE account to a specific PicoPay customer (a shared/store
// QR code alone could never do this — see project notes).
const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });
}

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};

  const redirectBackWithError = (message) => ({
    statusCode: 302,
    headers: { Location: `/customer?id=${encodeURIComponent(state || "")}&lineError=${encodeURIComponent(message)}` },
  });

  if (error) return redirectBackWithError(error);
  if (!code || !state) return redirectBackWithError("missing_code_or_state");

  try {
    const db = admin.database();

    // Each PicoPay deployment is single-tenant, so this store's own LINE
    // Login credentials live in this same Firebase project.
    const [settingsSnap, secretsSnap] = await Promise.all([
      db.ref("storeSettings/lineLoginChannelId").once("value"),
      db.ref("storeSecrets/lineLoginChannelSecret").once("value"),
    ]);
    const clientId = settingsSnap.val();
    const clientSecret = secretsSnap.val();
    if (!clientId || !clientSecret) return redirectBackWithError("line_login_not_configured");

    const redirectUri = `${new URL(event.rawUrl || `https://${event.headers.host}${event.path}`).origin}/.netlify/functions/line-login-callback`;

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) return redirectBackWithError("token_exchange_failed");
    const tokenData = await tokenRes.json();

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) return redirectBackWithError("profile_fetch_failed");
    const profile = await profileRes.json();

    // Save the LINE userId against this customer's account.
    await db.ref(`accounts/${state}/lineUserId`).set(profile.userId);

    return {
      statusCode: 302,
      headers: { Location: `/customer?id=${encodeURIComponent(state)}&lineLinked=1` },
    };
  } catch (e) {
    return redirectBackWithError("unexpected_error");
  }
};
