/**
 * Basecheck x402 Supporter - Vercel API Route
 */

const PAY_TO = process.env.PAY_TO;
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

const FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RESOURCE = "https://basecheck.vercel.app/api/supporter";
const AMOUNT = "10000";

const PAYMENT_REQUIREMENTS = {
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: AMOUNT,
  resource: RESOURCE,
  description: "Support Basecheck – 0.01 USDC",
  mimeType: "application/json",
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  asset: USDC_BASE,
  extra: { name: "USDC", version: "2" }
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, payment-signature, X-PAYMENT",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function generateCDPJWT() {
  const rawKey = Buffer.from(CDP_API_KEY_SECRET.trim(), "base64");
  const pkcs8Prefix = Buffer.from(
    "3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420",
    "hex"
  );
  const pkcs8Key = Buffer.concat([pkcs8Prefix, rawKey]);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: CDP_API_KEY_ID };
  const payload = { sub: CDP_API_KEY_ID, iss: "cdp", nbf: now, exp: now + 120 };

  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sigInput = `${h}.${p}`;

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    Buffer.from(sigInput)
  );

  return `${sigInput}.${Buffer.from(sig).toString("base64url")}`;
}

async function callFacilitator(endpoint, body) {
  const jwt = await generateCDPJWT();
  const res = await fetch(`${FACILITATOR_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}

export default async function handler(req, res) {
  // CORS
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const paymentHeader =
    req.headers["payment-signature"] ||
    req.headers["PAYMENT-SIGNATURE"] ||
    req.headers["x-payment"] ||
    req.headers["X-PAYMENT"];

  if (!paymentHeader) {
    res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify({
      version: "2",
      accepts: [PAYMENT_REQUIREMENTS]
    })).toString("base64"));
    return res.status(402).json({ error: "Payment required", accepts: [PAYMENT_REQUIREMENTS] });
  }

  try {
    let payment;
    try { payment = JSON.parse(Buffer.from(paymentHeader, "base64").toString()); }
    catch { payment = JSON.parse(paymentHeader); }

    const verified = await callFacilitator("verify", {
      payment,
      paymentRequirements: PAYMENT_REQUIREMENTS,
    });

    console.log("Verify:", JSON.stringify(verified));

    if (!verified.isValid) {
      return res.status(402).json({ error: "Verification failed", details: verified });
    }

    const settled = await callFacilitator("settle", {
      payment,
      paymentRequirements: PAYMENT_REQUIREMENTS,
    });

    console.log("Settle:", JSON.stringify(settled));

    return res.status(200).json({
      success: true,
      message: "Thank you for supporting Basecheck! ✅",
      txHash: settled.transaction || settled.txHash || null,
    });

  } catch (err) {
    console.error("x402 error:", err);
    return res.status(500).json({ error: err.message });
  }
}
