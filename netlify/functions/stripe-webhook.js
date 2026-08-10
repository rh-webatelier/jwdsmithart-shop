// Listens for successful Stripe payments and marks the matching painting "sold" in
// content/paintings.json by committing the change directly to the GitHub repo — the same
// file the site (and the Decap CMS) already reads from, so no separate database is needed.
//
// Requires three Netlify env vars:
//   STRIPE_SECRET_KEY      — already set for create-checkout.js
//   STRIPE_WEBHOOK_SECRET  — from the Stripe Dashboard webhook endpoint (starts with whsec_)
//   GITHUB_TOKEN           — a GitHub personal access token with write access to this repo
//
// Optional (defaults shown):
//   GITHUB_REPO   = "rh-webatelier/jwdsmithart-shop"
//   GITHUB_BRANCH = "main"

const GITHUB_REPO = process.env.GITHUB_REPO || 'rh-webatelier/jwdsmithart-shop';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'content/paintings.json';

// Mirrors the client-side fallback in script.js: a painting added via the CMS without a
// manually-set slug is still matched by its title, slugified the same way.
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function markPaintingSold(slug) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jwdsmithart-shop-webhook',
  };

  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) throw new Error(`GitHub read failed: ${getRes.status}`);
  const file = await getRes.json();

  const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  const painting = (content.paintings || []).find((p) => (p.slug || slugify(p.title)) === slug);
  if (!painting) throw new Error(`No painting found with slug "${slug}"`);
  if (painting.sold) return { alreadySold: true, title: painting.title };

  painting.sold = true;

  const updatedContent = Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8').toString('base64');

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Mark "${painting.title}" as sold (via Stripe payment)`,
      content: updatedContent,
      sha: file.sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub write failed: ${putRes.status} ${errText}`);
  }

  return { alreadySold: false, title: painting.title };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.GITHUB_TOKEN) {
    return { statusCode: 503, body: JSON.stringify({ error: 'webhook_not_configured' }) };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ ignored: stripeEvent.type }) };
  }

  const session = stripeEvent.data.object;
  const slug = session.metadata && session.metadata.painting_slug;
  if (!slug) {
    return { statusCode: 200, body: JSON.stringify({ ignored: 'no_painting_slug_in_metadata' }) };
  }

  try {
    const result = await markPaintingSold(slug);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    // Return 500 so Stripe retries the webhook automatically — a transient GitHub API
    // hiccup shouldn't silently leave a paid-for painting showing as still for sale.
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
