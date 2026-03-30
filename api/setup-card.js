// Creates a Stripe Customer + SetupIntent to save card on file
const https = require('https');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

function stripeRequest(path, params) {
  return new Promise(function(resolve, reject) {
    if (!STRIPE_KEY) { resolve({ skip: true }); return; }
    var data = new URLSearchParams(params).toString();
    var req = https.request('https://api.stripe.com/v1' + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(STRIPE_KEY + ':').toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    }, function(res) {
      var c = ''; res.on('data', function(d) { c += d; }); res.on('end', function() {
        try { resolve(JSON.parse(c)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!STRIPE_KEY) { res.status(200).json({ skip: true }); return; }

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    var { name, phone, email } = body;

    // Create or find Stripe customer
    var customer = await stripeRequest('/customers', {
      name: name, phone: phone, email: email || '',
      'metadata[source]': 'ajcuts-booking',
    });
    if (!customer.id) { res.status(200).json({ skip: true }); return; }

    // Create SetupIntent to save card
    var setupIntent = await stripeRequest('/setup_intents', {
      customer: customer.id,
      'payment_method_types[0]': 'card',
      'metadata[customer_name]': name,
      'metadata[customer_phone]': phone,
    });

    res.status(200).json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch(err) {
    console.error('Setup card error:', err.message);
    res.status(200).json({ skip: true });
  }
};
