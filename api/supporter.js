/**
 * Basecheck x402 Supporter - Vercel API Route
 * Verwendet @coinbase/cdp-sdk für JWT Auth
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

async function generateJWT(method, path) {
  const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
  return generateJwt({
    apiKeyId: CDP_API_KEY_ID,
    apiKeySecret: CDP_API_KEY_SECRET,
    requestMethod: method,
    requestHost: "api.cdp.coinbase.com",
    requestPath: path,
    expiresIn: 120,
  });
}

async function callFacilitator(endpoint, body) {
  const path = `/platform/v2/x402/${endpoint}`;
  const jwt = await generateJWT("POST", path);
  const res = await fetch(`https://api.cdp.coinbase.com${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") return res.status(200).end();

  const paymentHeader =
    req.headers["payment-signature"] ||
    req.headers["x-payment"];

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
