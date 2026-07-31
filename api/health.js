module.exports = (_request, response) => {
  response.status(200).json({ status: "ok", service: "mua-bundle-fulfillment" });
};
