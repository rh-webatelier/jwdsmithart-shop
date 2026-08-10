// Listens for successful Stripe payments, marks the matching painting "sold" in
// content/paintings.json (committed straight to GitHub — the same file the site and the
// Decap CMS already read from, so no separate database is needed), and emails both the
// seller and the buyer an order notification via Resend.
//
// Required Netlify env vars:
//   STRIPE_SECRET_KEY      — already set for create-checkout.js
//   STRIPE_WEBHOOK_SECRET  — from the Stripe Dashboard webhook endpoint (starts with whsec_)
//   GITHUB_TOKEN           — a GitHub personal access token with write access to this repo
//   RESEND_API_KEY         — from resend.com, used to send the two order emails
//
// Optional (defaults shown):
//   GITHUB_REPO   = "rh-webatelier/jwdsmithart-shop"
//   GITHUB_BRANCH = "main"
//   SELLER_EMAIL  = "jwdsmithart@mail.co.uk"
//   EMAIL_FROM    = "JWD Smith Art <onboarding@resend.dev>"
//
// If RESEND_API_KEY isn't set, the sold-marking still works — emails are just skipped
// (logged, not thrown) so a missing email config never blocks the actual sale.

const GITHUB_REPO = process.env.GITHUB_REPO || 'rh-webatelier/jwdsmithart-shop';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH = 'content/paintings.json';
const SELLER_EMAIL = process.env.SELLER_EMAIL || 'jwdsmithart@mail.co.uk';
const EMAIL_FROM = process.env.EMAIL_FROM || 'JWD Smith Art <onboarding@resend.dev>';

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
  if (painting.sold) return { alreadySold: true, painting };

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

  return { alreadySold: false, painting };
}

function shippingLabel(session) {
  var amount = session.shipping_cost && typeof session.shipping_cost.amount_total === 'number'
    ? session.shipping_cost.amount_total
    : null;
  if (amount === 0) return 'Collection from Otley';
  if (amount === 1500) return 'UK Shipping';
  if (amount === 4500) return 'Worldwide Shipping';
  return 'See order for shipping details';
}

function collectionTimeNote(session) {
  var field = (session.custom_fields || []).find(function (f) { return f.key === 'collection_time'; });
  var value = field && field.text && field.text.value;
  return value ? value : '';
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: subject, html: html }),
  });
  if (!res.ok) {
    var errText = await res.text();
    console.error('Resend send failed for', to, res.status, errText);
  }
}

async function sendOrderEmails(painting, session) {
  var buyerEmail = session.customer_details && session.customer_details.email;
  var buyerName = (session.customer_details && session.customer_details.name) || 'the buyer';
  var shipping = shippingLabel(session);
  var collectionTime = collectionTimeNote(session);
  var amountPaid = typeof session.amount_total === 'number' ? (session.amount_total / 100).toFixed(2) : painting.price;

  var sellerHtml =
    '<h2>New sale: ' + painting.title + '</h2>' +
    '<p><b>Price paid:</b> £' + amountPaid + '</p>' +
    '<p><b>Delivery:</b> ' + shipping + '</p>' +
    (collectionTime ? '<p><b>Preferred collection time:</b> ' + collectionTime + '</p>' : '') +
    '<p><b>Buyer:</b> ' + buyerName + (buyerEmail ? ' — ' + buyerEmail : '') + '</p>' +
    '<p>Full shipping address and payment details are in your Stripe Dashboard.</p>';

  var buyerHtml =
    '<h2>Thanks for your order — ' + painting.title + '</h2>' +
    '<p>Your payment of £' + amountPaid + ' has gone through and the painting is now reserved for you.</p>' +
    '<p><b>Delivery:</b> ' + shipping + '</p>' +
    (collectionTime ? '<p><b>Your preferred collection time:</b> ' + collectionTime + '</p>' : '') +
    '<p>Jonathan will be in touch shortly to confirm ' + (shipping.indexOf('Collection') === 0 ? 'a collection time' : 'delivery') + '.</p>' +
    '<p>Any questions, just reply to this email or contact jwdsmithart@mail.co.uk.</p>';

  await Promise.all([
    sendEmail(SELLER_EMAIL, 'New sale: ' + painting.title, sellerHtml),
    buyerEmail ? sendEmail(buyerEmail, 'Your order — ' + painting.title, buyerHtml) : Promise.resolve(),
  ]);
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
    // Only email on the sale that actually flips the flag — a Stripe webhook retry
    // (or a genuine duplicate delivery) must never send the buyer two confirmation emails.
    if (!result.alreadySold) {
      await sendOrderEmails(result.painting, session);
    }
    return { statusCode: 200, body: JSON.stringify({ alreadySold: result.alreadySold, title: result.painting.title }) };
  } catch (err) {
    // Return 500 so Stripe retries the webhook automatically — a transient GitHub API
    // hiccup shouldn't silently leave a paid-for painting showing as still for sale.
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
