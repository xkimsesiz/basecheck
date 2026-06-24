/**
 * Basecheck x402 Supporter Endpoint
 * Echte CDP Facilitator Integration – verify + settle
 */

const PAY_TO = process.env.PAY_TO;
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

const FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const AMOUNT = "10000"; // 0.01 USDC (6 decimals)
const RESOURCE = "https://basecheck.netlify.app/support";

const PAYMENT_REQUIREMENTS = {
  scheme: "exact",
  network: NETWORK,
  maxAmountRequired: AMOUNT,
  resource: RESOURCE,
  description: "Support Basecheck – 0.01 USDC",
  mimeType: "application/json",
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  asset: USDC_BASE,
  extra: { name: "USDC", version: "2" }
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, payment-signature, X-PAYMENT",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// CDP JWT generieren für API-Authentifizierung
async function generateCDPJWT() {
  const pemContent = CDP_API_KEY_SECRET
    .replace(/-----BEGIN.*?-----/g, "")
    .replace(/-----END.*?-----/g, "")
    .replace(/\s/g, "");

  const keyData = Buffer.from(pemContent, "base64");

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: CDP_API_KEY_ID };
  const payload = {
    sub: CDP_API_KEY_ID,
    iss: "cdp",
    nbf: now,
    exp: now + 120,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    Buffer.from(signingInput)
  );

  const sigB64 = Buffer.from(signature).toString("base64url");
  return `${signingInput}.${sigB64}`;
}

// CDP Facilitator aufrufen
async function callFacilitator(endpoint, body) {
  const jwt = await generateCDPJWT();
  const response = await fetch(`${FACILITATOR_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

export const handler = async (event) => {
  // CORS Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Payment-Signature Header lesen
  const paymentHeader =
    event.headers["payment-signature"] ||
    event.headers["PAYMENT-SIGNATURE"] ||
    event.headers["x-payment"] ||
    event.headers["X-PAYMENT"];

  // Kein Payment → 402 zurückgeben
  if (!paymentHeader) {
    return {
      statusCode: 402,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({
          version: "2",
          accepts: [PAYMENT_REQUIREMENTS]
        })).toString("base64"),
      },
      body: JSON.stringify({
        error: "Payment required",
        accepts: [PAYMENT_REQUIREMENTS]
      }),
    };
  }

  // Payment vorhanden → Verify + Settle über CDP Facilitator
  try {
    let payment;
    try {
      payment = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf-8"));
    } catch {
      payment = JSON.parse(paymentHeader);
    }

    // 1. Verify
    const verifyResult = await callFacilitator("verify", {
      payment,
      paymentRequirements: PAYMENT_REQUIREMENTS,
    });

    if (!verifyResult.isValid) {
      return {
        statusCode: 402,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Payment verification failed", details: verifyResult }),
      };
    }

    // 2. Settle
    const settleResult = await callFacilitator("settle", {
      payment,
      paymentRequirements: PAYMENT_REQUIREMENTS,
    });

    if (settleResult.success === false) {
      return {
        statusCode: 402,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Payment settlement failed", details: settleResult }),
      };
    }

    // 3. Erfolg
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settleResult)).toString("base64"),
      },
      body: JSON.stringify({
        success: true,
        message: "Thank you for supporting Basecheck! ✅",
        txHash: settleResult.transaction || settleResult.txHash || null,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error("x402 error:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error", message: error.message }),
    };
  }
};
