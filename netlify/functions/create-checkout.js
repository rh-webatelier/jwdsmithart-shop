// Creates a Stripe Checkout Session on the fly from the painting's current CMS data
// (title, price, photo) — no product has to be pre-created or kept in sync in Stripe.
// Requires the STRIPE_SECRET_KEY environment variable to be set in Netlify.
// Until then, this returns a 503 and the Buy button falls back to the "Ask a question" link.

const SHIPPING_OPTIONS = [
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 0, currency: 'gbp' },
      display_name: 'Collection from Otley (free)',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 1 },
        maximum: { unit: 'business_day', value: 7 },
      },
    },
  },
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 1500, currency: 'gbp' },
      display_name: 'UK Shipping',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 2 },
        maximum: { unit: 'business_day', value: 5 },
      },
    },
  },
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: 4500, currency: 'gbp' },
      display_name: 'Worldwide Shipping',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 7 },
        maximum: { unit: 'business_day', value: 21 },
      },
    },
  },
];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'stripe_not_connected' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const title = String(payload.title || '').slice(0, 200);
  const price = Number(payload.price);
  const image = String(payload.image || '');
  const slug = String(payload.slug || '').slice(0, 200);

  if (!title || !price || price <= 0 || !slug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing_fields' }) };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const origin = event.headers.origin || `https://${event.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // No payment_method_types here on purpose — leaving it unset lets Stripe use whatever
      // is enabled in the Dashboard (Settings → Payment methods) and, crucially, promotes
      // Apple Pay / Google Pay into the prominent "Express checkout" button above the card
      // form when the browser/device supports them, instead of listing it as a second option.
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: title,
              images: image ? [`${origin}/${image}`] : undefined,
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1,
        },
      ],
      // Worldwide list kept explicit (rather than "everywhere") so unsupported/high-risk
      // territories don't silently show up as a shippable option.
      shipping_address_collection: {
        allowed_countries: [
          'GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE',
          'PT', 'SE', 'NO', 'DK', 'FI', 'CH', 'AT', 'PL', 'JP', 'SG', 'AE',
        ],
      },
      shipping_options: SHIPPING_OPTIONS,
      custom_text: {
        shipping_address: {
          message: "Collecting in person from Otley? You can still fill this in — it's only used if you choose postal delivery below.",
        },
      },
      custom_fields: [
        {
          key: 'collection_time',
          label: { type: 'custom', custom: 'Preferred collection time (if collecting)' },
          type: 'text',
          optional: true,
        },
      ],
      metadata: { painting_slug: slug },
      success_url: `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#paintings`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
