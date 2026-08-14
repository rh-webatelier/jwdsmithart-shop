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

// A plain PUT to the GitHub Contents API fails with 409 if the file changed since we read
// its sha (e.g. two admin clicks landing close together). Re-reading the latest sha and
// retrying once covers that case without the admin having to notice and click again.
async function writeJsonFileWithRetry(path, headers, mutate, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await readJsonFile(path, headers);
    mutate(file.content);
    const updatedContent = Buffer.from(JSON.stringify(file.content, null, 2) + '\n', 'utf8').toString('base64');
    const putRes = await fetch(file.apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: updatedContent, sha: file.sha, branch: GITHUB_BRANCH }),
    });
    if (putRes.ok) return;
    if (putRes.status === 409 && attempt === 0) continue; // stale sha — retry with a fresh read
    const errText = await putRes.text();
    throw new Error(`GitHub write failed for ${path}: ${putRes.status} ${errText}`);
  }
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Netlify verifies the Identity JWT for us and only fills this in for a logged-in user.
  if (!context.clientContext || !context.clientContext.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in — please log in again and retry.' }) };
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
    // Read the source list once to find the painting (findAndRemove happens for real below,
    // with a fresh read, so this first read is just to know what we're moving).
    const sourceNow = await readJsonFile(fromPath, headers);
    const found = (sourceNow.content.paintings || []).find((p) => (p.slug || slugify(p.title)) === slug);
    if (!found) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Painting not found — the list may already be up to date. Refresh the page.' }) };
    }

    // Write the destination first — if this succeeds but the source removal below fails,
    // the painting is temporarily listed in both places (safe, just re-run the move),
    // never in neither (which would look like the painting vanished).
    await writeJsonFileWithRetry(toPath, headers, (content) => {
      var already = (content.paintings || []).some((p) => (p.slug || slugify(p.title)) === slug);
      if (!already) content.paintings = [found].concat(content.paintings || []);
    }, `${direction === 'sell' ? 'Mark' : 'Unmark'} "${found.title}" as sold (manual, via admin)`);

    await writeJsonFileWithRetry(fromPath, headers, (content) => {
      const list = content.paintings || [];
      const idx = list.findIndex((p) => (p.slug || slugify(p.title)) === slug);
      if (idx !== -1) list.splice(idx, 1);
    }, `Remove "${found.title}" from ${direction === 'sell' ? 'For Sale' : 'Sold Works'} (manual, via admin)`);

    return { statusCode: 200, body: JSON.stringify({ ok: true, painting: found }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
