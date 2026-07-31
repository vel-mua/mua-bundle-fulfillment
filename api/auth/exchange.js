const { saveAdminToken } = require('../../lib/token-store');

module.exports = async (request, response) => {
  const sessionToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (request.method !== 'POST' || !sessionToken) return response.status(401).send('Missing Shopify session token.');
  const body = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
  });
  const result = await fetch(`https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  if (!result.ok) return response.status(401).send('Shopify token exchange failed.');
  const { access_token } = await result.json();
  await saveAdminToken(access_token);
  response.status(200).json({ connected: true });
};
