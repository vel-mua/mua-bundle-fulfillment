const { exchangeSessionToken } = require('../../lib/session-token');

module.exports = async (request, response) => {
  const sessionToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (request.method !== 'POST' || !sessionToken) return response.status(401).send('Missing Shopify session token.');
  try {
    await exchangeSessionToken(sessionToken);
    response.status(200).json({ connected: true });
  } catch (_error) {
    response.status(401).send('Shopify token exchange failed.');
  }
};
