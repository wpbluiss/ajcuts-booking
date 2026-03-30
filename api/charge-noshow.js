// Charges no-show fee or late cancellation
const https = require('https');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

function stripeRequest(path, params) {
  return new Promise(function(resolve, reject) {
    if (!STRIPE_KEY) { resolve(null); return; }
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
  if (!STRIPE_KEY) { res.status(200).json({ error: 'Stripe not configured' }); return; }

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    var { customerId, amount, reason, appointmentId } = body;
    // amount in cents

    if (!customerId || !amount) {
      res.status(400).json({ error: 'Missing customerId or amount' }); return;
    }

    // Get customer's default payment method
    var customer = await stripeRequest('/customers/' + customerId, {});
    // List payment methods
    var pmList = await new Promise(function(resolve) {
      https.get('https://api.stripe.com/v1/payment_methods?customer=' + customerId + '&type=card&limit=1', {
        headers: { 'Authorization': 'Basic ' + Buffer.from(STRIPE_KEY + ':').toString('base64') }
      }, function(r) {
        var c = ''; r.on('data', function(d) { c += d; }); r.on('end', function() {
          try { resolve(JSON.parse(c)); } catch(e) { resolve(null); }
        });
      }).on('error', function() { resolve(null); });
    });

    if (!pmList || !pmList.data || !pmList.data[0]) {
      res.status(200).json({ error: 'No payment method on file' }); return;
    }

    var paymentMethod = pmList.data[0].id;

    // Create and confirm PaymentIntent
    var payment = await stripeRequest('/payment_intents', {
      amount: String(amount),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethod,
      confirm: 'true',
      off_session: 'true',
      description: reason || 'No-show fee - AJ Cuts',
      'metadata[appointment_id]': appointmentId || '',
      'metadata[reason]': reason || 'no_show',
    });

    if (payment && payment.status === 'succeeded') {
      res.status(200).json({ success: true, paymentId: payment.id, amount: amount });
    } else {
      res.status(200).json({ error: 'Charge failed', details: payment?.last_payment_error?.message || 'unknown' });
    }
  } catch(err) {
    console.error('No-show charge error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
