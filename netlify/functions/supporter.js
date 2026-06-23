const { paymentMiddleware, Network } = require("@x402/express");
const { facilitator } = require("@coinbase/x402");

const PAY_TO = process.env.PAY_TO;
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "https://basecheck.netlify.app",
    "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Check for payment signature
  const paymentSignature = event.headers["payment-signature"] || 
                           event.headers["PAYMENT-SIGNATURE"];

  if (!paymentSignature) {
    // No payment – return 402 with payment requirements
    return {
      statusCode: 402,
      headers: {
        ...headers,
        "PAYMENT-REQUIRED": JSON.stringify({
          version: "2",
          accepts: [
            {
              scheme: "exact",
              network: "eip155:8453",
              maxAmountRequired: "10000", // 0.01 USDC (6 decimals)
              resource: "https://basecheck.netlify.app/.netlify/functions/supporter",
              description: "Support Basecheck – 0.01 USDC",
              mimeType: "application/json",
              payTo: PAY_TO,
              maxTimeoutSeconds: 60,
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
              extra: {
                name: "USDC",
                version: "2"
              }
            }
          ]
        })
      },
      body: JSON.stringify({ error: "Payment required", message: "Send 0.01 USDC to support Basecheck" })
    };
  }

  // Payment provided – verify and return supporter content
  try {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "🎉 Thank you for supporting Basecheck!",
        supporter: true,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Payment verification failed" })
    };
  }
};
