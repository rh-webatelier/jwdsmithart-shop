// Looks up which painting a completed Checkout Session was for, so thank-you.html can show
// its photo/title. Only needs STRIPE_SECRET_KEY — no GitHub write access required here.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'stripe_not_connected' }) };
  }
  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing_session_id' }) };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      statusCode: 200,
      body: JSON.stringify({
        slug: (session.metadata && session.metadata.painting_slug) || null,
        amountTotal: session.amount_total,
      }),
    };
  } catch (err) {
    return { statusCode: 404, body: JSON.stringify({ error: 'session_not_found' }) };
  }
};
