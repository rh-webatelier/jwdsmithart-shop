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
const FOR_SALE_PATH = 'content/paintings.json';
const SOLD_PATH = 'content/paintings-sold.json';
const SELLER_EMAIL = process.env.SELLER_EMAIL || 'jwdsmithart@mail.co.uk';
const EMAIL_FROM = process.env.EMAIL_FROM || 'JWD Smith Art <onboarding@resend.dev>';

// Mirrors the client-side fallback in script.js: a painting added via the CMS without a
// manually-set slug is still matched by its title, slugified the same way.
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function readJsonFile(path) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jwdsmithart-shop-webhook',
  };
  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) throw new Error(`GitHub read failed for ${path}: ${getRes.status}`);
  const file = await getRes.json();
  const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  return { apiUrl, headers, sha: file.sha, content };
}

async function writeJsonFile(apiUrl, headers, sha, content, message) {
  const updatedContent = Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8').toString('base64');
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: updatedContent, sha, branch: GITHUB_BRANCH }),
  });
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub write failed: ${putRes.status} ${errText}`);
  }
}

// Moves a painting from the "for sale" file to the "sold" file — the two files back the two
// separate CMS sections (Paintings for Sale / Sold Works), so a sale keeps the editor tidy
// instead of leaving a growing pile of "sold" checkboxes mixed in with what's still available.
async function markPaintingSold(slug) {
  const sold = await readJsonFile(SOLD_PATH);
  const alreadyMoved = (sold.content.paintings || []).find((p) => (p.slug || slugify(p.title)) === slug);
  if (alreadyMoved) return { alreadySold: true, painting: alreadyMoved };

  const forSale = await readJsonFile(FOR_SALE_PATH);
  const list = forSale.content.paintings || [];
  const idx = list.findIndex((p) => (p.slug || slugify(p.title)) === slug);
  if (idx === -1) throw new Error(`No painting found with slug "${slug}"`);
  const [painting] = list.splice(idx, 1);

  await writeJsonFile(forSale.apiUrl, forSale.headers, forSale.sha, forSale.content,
    `Remove "${painting.title}" from For Sale (sold via Stripe)`);

  sold.content.paintings = [painting].concat(sold.content.paintings || []);
  await writeJsonFile(sold.apiUrl, sold.headers, sold.sha, sold.content,
    `Add "${painting.title}" to Sold Works (via Stripe payment)`);

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

function formatAddress(session) {
  var addr = (session.shipping_details && session.shipping_details.address) ||
    (session.customer_details && session.customer_details.address);
  if (!addr) return '';
  var name = (session.shipping_details && session.shipping_details.name) ||
    (session.customer_details && session.customer_details.name) || '';
  var lines = [name, addr.line1, addr.line2, [addr.city, addr.postal_code].filter(Boolean).join(' '), addr.country]
    .filter(Boolean);
  return lines.join('<br>');
}

async function sendOrderEmails(painting, session) {
  var buyerEmail = session.customer_details && session.customer_details.email;
  var buyerName = (session.customer_details && session.customer_details.name) || 'the buyer';
  var shipping = shippingLabel(session);
  var collectionTime = collectionTimeNote(session);
  var address = formatAddress(session);
  var amountPaid = typeof session.amount_total === 'number' ? (session.amount_total / 100).toFixed(2) : painting.price;
  var origin = 'https://whimsical-kashata-a78505.netlify.app';
  var imageUrl = painting.image ? origin + '/' + painting.image : '';

  function wrapEmail(bodyHtml) {
    return (
      '<div style="background:#f7f3ea;padding:32px 16px;font-family:Georgia,\'Times New Roman\',serif;">' +
        '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e2d9c6;">' +
          '<div style="background:#1b1915;padding:20px 28px;">' +
            '<span style="color:#f7f3ea;font-size:20px;letter-spacing:.02em;">JWD Smith Art</span>' +
          '</div>' +
          (imageUrl ? '<img src="' + imageUrl + '" alt="" style="width:100%;display:block;max-height:260px;object-fit:cover;" />' : '') +
          '<div style="padding:28px;color:#2c2822;font-size:15px;line-height:1.6;">' + bodyHtml + '</div>' +
          '<div style="padding:16px 28px;background:#efe8da;color:#6c6353;font-size:12px;">' +
            'JWD Smith Art &middot; Otley, West Yorkshire' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function row(label, value) {
    return (
      '<tr>' +
        '<td style="padding:6px 0;color:#6c6353;font-size:13px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;padding-right:14px;">' + label + '</td>' +
        '<td style="padding:6px 0;font-size:15px;">' + value + '</td>' +
      '</tr>'
    );
  }

  var sellerHtml = wrapEmail(
    '<h2 style="margin:0 0 4px;font-size:22px;">New sale</h2>' +
    '<p style="margin:0 0 18px;color:#a9762e;font-weight:bold;">' + painting.title + '</p>' +
    '<table style="border-collapse:collapse;width:100%;">' +
      row('Price paid', '£' + amountPaid) +
      row('Delivery', shipping) +
      (collectionTime ? row('Collection time', collectionTime) : '') +
      row('Buyer', buyerName + (buyerEmail ? '<br><span style="color:#6c6353;">' + buyerEmail + '</span>' : '')) +
      (address ? row('Address', address) : '') +
    '</table>' +
    '<p style="margin:20px 0 0;color:#6c6353;font-size:13px;">Full payment details are in your Stripe Dashboard.</p>'
  );

  var buyerHtml = wrapEmail(
    '<h2 style="margin:0 0 4px;font-size:22px;">Thank you for your order</h2>' +
    '<p style="margin:0 0 18px;color:#a9762e;font-weight:bold;">' + painting.title + '</p>' +
    '<p style="margin:0 0 18px;">Your payment of <b>£' + amountPaid + '</b> has gone through and this original is now reserved for you.</p>' +
    '<table style="border-collapse:collapse;width:100%;">' +
      row('Delivery', shipping) +
      (collectionTime ? row('Your collection time', collectionTime) : '') +
      (address && shipping.indexOf('Collection') !== 0 ? row('Delivery address', address) : '') +
    '</table>' +
    '<p style="margin:20px 0 0;">I\'ll be in touch shortly to confirm ' +
      (shipping.indexOf('Collection') === 0 ? 'a collection time' : 'delivery') + '.</p>' +
    '<p style="margin:12px 0 0;color:#6c6353;font-size:13px;">Any questions, just reply to this email or contact jwdsmithart@mail.co.uk.' +
      ' (Can\'t find this email later? Check your spam/junk folder and mark it as not spam.)</p>'
  );

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
