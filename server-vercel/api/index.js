module.exports = (req, res) => {
  res.status(200).send('Kompaniya push relay (Vercel) is running. Endpoint: POST /api/notify');
};