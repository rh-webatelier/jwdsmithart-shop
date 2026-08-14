// Manual "Mark as sold" / "Move back to For Sale" action for the admin Manage page.
// Requires the caller to be logged in via Netlify Identity (the same login already used
// for the Decap CMS) — Netlify automatically verifies the identity token and hands us the
// logged-in user as context.clientContext.user, so no separate password check is needed here.
//
// Required Netlify env vars (already set for the Stripe webhook):
//   GITHUB_TOKEN
// Optional:
//   GITHUB_REPO   = "rh-webatelier/jwdsmithart-shop"
//   GITHUB_BRANCH = "main"

const GITHUB_REPO = process.env.GITHUB_REPO || 'rh-webatelier/jwdsmithart-shop';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const FOR_SALE_PATH = 'content/paintings.json';
const SOLD_PATH = 'content/paintings-sold.json';

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function readJsonFile(path, headers) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) throw new Error(`GitHub read failed for ${path}: ${getRes.status}`);
  const file = await getRes.json();
  const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  return { apiUrl, sha: file.sha, content };
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

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Netlify verifies the Identity JWT for us and only fills this in for a logged-in user.
  if (!context.clientContext || !context.clientContext.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'not_logged_in' }) };
  }

  if (!process.env.GITHUB_TOKEN) {
    return { statusCode: 503, body: JSON.stringify({ error: 'github_not_configured' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const slug = String(payload.slug || '');
  const direction = payload.direction; // 'sell' or 'unsell'
  if (!slug || (direction !== 'sell' && direction !== 'unsell')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing_fields' }) };
  }

  const fromPath = direction === 'sell' ? FOR_SALE_PATH : SOLD_PATH;
  const toPath = direction === 'sell' ? SOLD_PATH : FOR_SALE_PATH;

  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jwdsmithart-shop-admin',
  };

  try {
    const from = await readJsonFile(fromPath, headers);
    const list = from.content.paintings || [];
    const idx = list.findIndex((p) => (p.slug || slugify(p.title)) === slug);
    if (idx === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'painting_not_found' }) };
    }
    const [painting] = list.splice(idx, 1);

    const to = await readJsonFile(toPath, headers);
    to.content.paintings = [painting].concat(to.content.paintings || []);

    // Write the destination first — if this succeeds but the source write below fails,
    // the painting is temporarily listed in both places (safe), never in neither.
    await writeJsonFile(to.apiUrl, headers, to.sha, to.content,
      `${direction === 'sell' ? 'Mark' : 'Unmark'} "${painting.title}" as sold (manual, via admin)`);
    await writeJsonFile(from.apiUrl, headers, from.sha, from.content,
      `Remove "${painting.title}" from ${direction === 'sell' ? 'For Sale' : 'Sold Works'} (manual, via admin)`);

    return { statusCode: 200, body: JSON.stringify({ ok: true, painting }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
